package reconciler

import (
	"sort"
	"strconv"
	"strings"
)

const (
	spendMeterFilterName     = "spend_meter"
	spendMetadataNamespace   = "platform.spend"
	spendCallHeader          = "x-platform-call"
	spendRecordLogName       = "spend"
	spendRecordFlushInterval = "2s"
	proxyCostHeader          = "x-litellm-response-cost"
)

func spendMeterHTTPFilter(p bootstrapParams, c envoyHostChain) ev {
	return ev{
		"name": spendMeterFilterName,
		"typed_config": ev{
			"@type":               "type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua",
			"default_source_code": ev{"inline_string": luaSpendMeterScript(p, c)},
		},
	}
}

func spendRecordAccessLog(p bootstrapParams) ev {
	return ev{
		"name": "envoy.access_loggers.http_grpc",
		"typed_config": ev{
			"@type": "type.googleapis.com/envoy.extensions.access_loggers.grpc.v3.HttpGrpcAccessLogConfig",
			"common_config": ev{
				"log_name":              spendRecordLogName,
				"transport_api_version": "V3",
				"buffer_size_bytes":     0,
				"grpc_service": ev{
					"envoy_grpc": ev{"cluster_name": "ext_authz_cluster", "authority": p.ExtAuthzHost},
				},
			},
			"additional_response_headers_to_log": []any{proxyCostHeader},
		},
		"filter": ev{
			"metadata_filter": ev{
				"matcher": ev{
					"filter": spendMetadataNamespace,
					"path":   []any{ev{"key": "billable"}},
					"value":  ev{"bool_match": true},
				},
				"match_if_key_not_found": false,
			},
		},
	}
}

func withoutPeriodicRecords(loggers []any) []any {
	for _, logger := range loggers {
		logger.(ev)["filter"] = ev{"log_type_filter": ev{"types": []any{"DownstreamPeriodic"}, "exclude": true}}
	}
	return loggers
}

func luaStringSet(items []string) string {
	sorted := append([]string(nil), items...)
	sort.Strings(sorted)
	entries := make([]string, 0, len(sorted))
	for _, item := range sorted {
		entries = append(entries, "["+strconv.Quote(item)+"] = true")
	}
	return "{" + strings.Join(entries, ", ") + "}"
}

func luaSpendMeterScript(p bootstrapParams, c envoyHostChain) string {
	return "local NS = " + strconv.Quote(spendMetadataNamespace) + "\n" +
		"local CALL_HEADER = " + strconv.Quote(spendCallHeader) + "\n" +
		"local ADDRESS_HEADER = " + strconv.Quote(connectionAddressHeader) + "\n" +
		"local ADDRESSED_PATH = " + strconv.Quote(luaAddressedPathPattern()) + "\n" +
		"local PAYER = " + strconv.Quote(p.PayerID()) + "\n" +
		"local CONNECTIONS = " + luaStringSet(c.MeteredConnectionIDs()) + "\n" +
		luaSpendMeterBody
}

const luaSpendMeterBody = `local MAX_OBJECT = 8192
local TAIL = 256
local MAX_FRAME = 1048576
local MAX_NAME = 256
local SHALLOWEST_FIELDS = {model = true, service_tier = true}
local FIELDS = {
  input_tokens = "input_tokens",
  prompt_tokens = "input_tokens",
  inputTokens = "input_tokens",
  inputTokenCount = "input_tokens",
  output_tokens = "output_tokens",
  completion_tokens = "output_tokens",
  outputTokens = "output_tokens",
  outputTokenCount = "output_tokens",
  cache_read_input_tokens = "cache_read_tokens",
  cacheReadInputTokens = "cache_read_tokens",
  cacheReadInputTokenCount = "cache_read_tokens",
  cache_creation_input_tokens = "cache_write_tokens",
  cacheWriteInputTokens = "cache_write_tokens",
  cacheWriteInputTokenCount = "cache_write_tokens",
  ephemeral_5m_input_tokens = "cache_write_5m_tokens",
  ephemeral_1h_input_tokens = "cache_write_1h_tokens",
  cached_tokens = "cached_tokens",
  web_search_requests = "web_search_requests",
  credits = "credits",
}
local USAGE_OBJECTS = {'"usage"%s*:%s*{', '"amazon%-bedrock%-invocationMetrics"%s*:%s*{'}
local STREAM_ENDS = {
  '"type"%s*:%s*"message_stop"',
  '\ndata:%s*%[DONE%]',
  '"type"%s*:%s*"response%.completed"',
  '"type"%s*:%s*"response%.incomplete"',
  '"type"%s*:%s*"response%.failed"',
}
local SEARCH_CALLS = {
  json = '"type"%s*:%s*"web_search_call"',
  sse = '"type"%s*:%s*"response%.web_search_call%.completed"',
}
local EVENT_TYPE = "\11:event-type\7"
local B64 = {}
do
  local alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  for i = 1, #alphabet do B64[string.byte(alphabet, i)] = i - 1 end
end
local WORKER = string.match(tostring({}), "0x(%x+)") or "0"
local sequence = 0

local function next_call_id(handle)
  sequence = sequence + 1
  return string.format("%.0f-%s-%d", handle:timestamp(), WORKER, sequence)
end

local function ends_with(s, suffix)
  return string.sub(s, -#suffix) == suffix
end

local function dialect_of(path)
  if ends_with(path, "/v1/messages") then return "anthropic-messages" end
  if ends_with(path, "/completions") then return "openai-chat" end
  if ends_with(path, "/responses") then return "openai-responses" end
  if ends_with(path, "/embeddings") then return "openai-embeddings" end
  if string.find(path, "/model/[^/]+/invoke$") or string.find(path, "/model/[^/]+/invoke%-with%-response%-stream$") then
    return "bedrock-invoke"
  end
  if string.find(path, "/model/[^/]+/converse$") or string.find(path, "/model/[^/]+/converse%-stream$") then
    return "bedrock-converse"
  end
  return nil
end

local function object_end(text, open)
  local depth, quoted, i = 0, false, open
  local limit = open + MAX_OBJECT
  while i <= #text do
    if i > limit then return false end
    local c = string.byte(text, i)
    if quoted then
      if c == 92 then i = i + 1 elseif c == 34 then quoted = false end
    elseif c == 34 then
      quoted = true
    elseif c == 123 then
      depth = depth + 1
    elseif c == 125 then
      depth = depth - 1
      if depth == 0 then return i end
    end
    i = i + 1
  end
  return nil
end

local function b64decode(s)
  local out = {}
  for i = 1, #s - 3, 4 do
    local a, b = B64[string.byte(s, i)], B64[string.byte(s, i + 1)]
    if a == nil or b == nil then break end
    local c, d = B64[string.byte(s, i + 2)], B64[string.byte(s, i + 3)]
    local v = a * 262144 + b * 4096 + (c or 0) * 64 + (d or 0)
    out[#out + 1] = string.char(math.floor(v / 65536))
    if c ~= nil then out[#out + 1] = string.char(math.floor(v / 256) % 256) end
    if d ~= nil then out[#out + 1] = string.char(v % 256) end
  end
  return table.concat(out)
end

local function new_meter(format)
  local meter = {fields = {}, ended = false}
  local fields = meter.fields
  local buf, base, counted = "", 0, 0
  local depth, quoted, escaped = 0, false, false
  local piece, last, last_depth, key, key_depth = nil, nil, 0, nil, 0
  local field_depth = {}

  local function settle(value)
    if key_depth <= (field_depth[key] or math.huge) then
      field_depth[key] = key_depth
      if value == nil or (key == "service_tier" and not string.find(value, "^[%w_%-]+$")) then
        value = ""
      end
      fields[key] = value
    end
    key = nil
  end

  local function read_shallowest_fields(data)
    local i, n = 1, #data
    while i <= n do
      if quoted and escaped then
        escaped, piece, i = false, false, i + 1
      elseif quoted then
        local j = string.find(data, '["\\]', i)
        if piece then
          piece = piece .. string.sub(data, i, (j or n + 1) - 1)
          if #piece > MAX_NAME then piece = false end
        end
        if j == nil then
          i = n + 1
        elseif string.byte(data, j) == 92 then
          escaped, i = true, j + 1
        else
          quoted, i = false, j + 1
          if key ~= nil then
            settle(piece or nil)
          else
            last, last_depth = piece, depth
          end
          piece = nil
        end
      else
        local c = string.byte(data, i)
        if c == 34 then
          quoted, piece = true, ""
        elseif c == 58 then
          if last and SHALLOWEST_FIELDS[last] then key, key_depth = last, last_depth end
          last = nil
        elseif c ~= 32 and c ~= 9 and c ~= 10 and c ~= 13 then
          if key ~= nil then settle(nil) end
          if c == 123 or c == 91 then
            depth = depth + 1
          elseif (c == 125 or c == 93) and depth > 0 then
            depth = depth - 1
          end
          last = nil
        end
        i = i + 1
      end
    end
  end

  local function merge(object)
    for key, value in string.gmatch(object, '"([%w_]+)"%s*:%s*(%-?[%d%.]+[eE]?[%-+]?%d*)') do
      local field, number = FIELDS[key], tonumber(value)
      if field ~= nil and number ~= nil and number > (fields[field] or -1) then
        fields[field] = number
      end
    end
  end

  local function next_object(text, from)
    local first, open
    for _, pattern in ipairs(USAGE_OBJECTS) do
      local s, e = string.find(text, pattern, from)
      if s ~= nil and (first == nil or s < first) then first, open = s, e end
    end
    return first, open
  end

  function meter.scan(data)
    read_shallowest_fields(data)
    local text = buf .. data
    local keep
    local from = 1
    while true do
      local s, open = next_object(text, from)
      if s == nil then break end
      local close = object_end(text, open)
      if close == nil then
        keep = s
        break
      end
      if close then merge(string.sub(text, open, close)) end
      from = (close or open) + 1
    end
    if format ~= "json" and not meter.ended then
      for _, pattern in ipairs(STREAM_ENDS) do
        if string.find(text, pattern) then
          meter.ended = true
          break
        end
      end
    end
    local search = SEARCH_CALLS[format]
    local at = 1
    while search ~= nil do
      local s, e = string.find(text, search, at)
      if s == nil then break end
      if base + s > counted then
        fields.web_search_calls = (fields.web_search_calls or 0) + 1
        counted = base + e
      end
      at = e + 1
    end
    local cut = keep or math.max(1, #text - TAIL + 1)
    if #text - cut >= MAX_OBJECT then cut = math.max(1, #text - TAIL + 1) end
    buf = string.sub(text, cut)
    base = base + cut - 1
  end

  return meter
end

local function u32(s, i)
  local a, b, c, d = string.byte(s, i, i + 3)
  return ((a * 256 + b) * 256 + c) * 256 + d
end

local function event_type(headers)
  local _, e = string.find(headers, EVENT_TYPE, 1, true)
  if e == nil or #headers < e + 2 then return nil end
  local hi, lo = string.byte(headers, e + 1, e + 2)
  return string.sub(headers, e + 3, e + 2 + hi * 256 + lo)
end

local function event_stream(meter)
  local buf = ""
  return function(data)
    buf = buf .. data
    while #buf >= 16 do
      local total = u32(buf, 1)
      if total < 16 or total > MAX_FRAME then
        buf = ""
        break
      end
      if #buf < total then break end
      local headers_end = 12 + u32(buf, 5)
      local kind = event_type(string.sub(buf, 13, headers_end))
      local payload = string.sub(buf, headers_end + 1, total - 4)
      buf = string.sub(buf, total + 1)
      local encoded = string.match(payload, '"bytes"%s*:%s*"([^"]*)"')
      if encoded ~= nil then
        meter.scan(b64decode((string.gsub(encoded, "\\", ""))) .. "\n")
      else
        meter.scan(payload .. "\n")
      end
      if kind == "metadata" then meter.ended = true end
    end
  end
end

local function publish(md, fields, sent)
  for field, value in pairs(fields) do
    if sent[field] ~= value then
      md:set(NS, field, value)
      sent[field] = value
    end
  end
end

function envoy_on_request(rh)
  local h = rh:headers()
  local call_id = next_call_id(rh)
  h:replace(CALL_HEADER, call_id)
  h:remove("accept-encoding")
  local path = string.match(h:get(":path") or "/", "^[^?]*")
  path = string.match(path, ADDRESSED_PATH) or path
  local dialect = dialect_of(path)
  local md = rh:streamInfo():dynamicMetadata()
  md:set(NS, "call_id", call_id)
  md:set(NS, "payer", PAYER)
  md:set(NS, "path", path)
  md:set(NS, "billable", dialect ~= nil)
  if dialect ~= nil then md:set(NS, "dialect", dialect) end
  local conn = h:get(ADDRESS_HEADER)
  if conn ~= nil and CONNECTIONS[conn] then md:set(NS, "conn", conn) end
end

function envoy_on_response(rh)
  local spend = rh:streamInfo():dynamicMetadata():get(NS)
  if spend == nil or spend.billable ~= true then return end
  local content_type = string.lower(rh:headers():get("content-type") or "")
  local format = "json"
  if string.find(content_type, "text/event-stream", 1, true) then
    format = "sse"
  elseif string.find(content_type, "application/vnd.amazon.eventstream", 1, true) then
    format = "eventstream"
  end
  local meter = new_meter(format)
  local feed = meter.scan
  if format == "eventstream" then feed = event_stream(meter) end
  local sent = {}
  local bytes = 0
  for chunk in rh:bodyChunks() do
    local data = chunk:getBytes(0, chunk:length())
    bytes = bytes + #data
    feed(data)
    publish(rh:streamInfo():dynamicMetadata(), meter.fields, sent)
  end
  local md = rh:streamInfo():dynamicMetadata()
  md:set(NS, "bytes", bytes)
  md:set(NS, "complete", format == "json" or meter.ended)
end
`

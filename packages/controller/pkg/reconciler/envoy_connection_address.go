package reconciler

import (
	"sort"
	"strconv"
	"strings"
)

func connectionAddressHTTPFilter(c envoyHostChain) ev {
	return ev{
		"name": "connection_address",
		"typed_config": ev{
			"@type":               "type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua",
			"default_source_code": ev{"inline_string": luaConnectionAddressScript(c)},
		},
	}
}

func addressedRoute(c envoyHostChain, connectionID, scope, match, rewrite string) ev {
	entry := scopedRoute(c, connectionID, scope, match, rewrite)
	entry["match"] = ev{
		"prefix": match,
		"headers": []any{
			ev{"name": connectionAddressHeader, "string_match": ev{"exact": connectionID}},
		},
	}
	return entry
}

func buildConnectionAddressRoutes(c envoyHostChain, connectionID string) []any {
	emitted := map[string]bool{}
	var routes []any
	add := func(scope, match, rewrite string) {
		if emitted[match] {
			return
		}
		emitted[match] = true
		routes = append(routes, addressedRoute(c, connectionID, scope, match, rewrite))
	}
	for _, scope := range c.ScopesOf(connectionID) {
		for _, r := range c.PathRewrites {
			if !scopeCovers(scope, r.Prefix) {
				continue
			}
			add(r.Prefix, r.Prefix, r.Replacement)
		}
		add(scope, scope, "")
	}
	return routes
}

func claimedHeaderNames(c envoyHostChain) []string {
	seen := map[string]bool{}
	var out []string
	for _, cred := range c.Credentials {
		name := strings.ToLower(cred.HeaderName)
		if cred.ConnectionID == "" || name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func claimedQueryParams(c envoyHostChain) []string {
	seen := map[string]bool{}
	var out []string
	for _, cred := range c.Credentials {
		if cred.ConnectionID == "" || cred.QueryParamName == "" || seen[cred.QueryParamName] {
			continue
		}
		seen[cred.QueryParamName] = true
		out = append(out, cred.QueryParamName)
	}
	sort.Strings(out)
	return out
}

func luaStringList(items []string) string {
	quoted := make([]string, 0, len(items))
	for _, item := range items {
		quoted = append(quoted, strconv.Quote(item))
	}
	return "{" + strings.Join(quoted, ", ") + "}"
}

func luaConnectionAddressScript(c envoyHostChain) string {
	return "local HEADERS = " + luaStringList(claimedHeaderNames(c)) + "\n" +
		"local PARAMS = " + luaStringList(claimedQueryParams(c)) + "\n" +
		"local ADDRESS_HEADER = " + strconv.Quote(connectionAddressHeader) + "\n" +
		"local PREFIX = " + strconv.Quote(connectionEgressPlaceholderPrefix) + "\n" +
		luaConnectionAddressBody
}

const luaConnectionAddressBody = `local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function b64decode(data)
  data = string.gsub(data, "[^" .. B64 .. "=]", "")
  local bits = string.gsub(data, ".", function(x)
    if x == "=" then return "" end
    local f = string.find(B64, x, 1, true) - 1
    local r = ""
    for i = 6, 1, -1 do
      r = r .. (f % 2 ^ i - f % 2 ^ (i - 1) > 0 and "1" or "0")
    end
    return r
  end)
  return (string.gsub(bits, "%d%d%d?%d?%d?%d?%d?%d?", function(x)
    if #x ~= 8 then return "" end
    local c = 0
    for i = 1, 8 do
      c = c + (string.sub(x, i, i) == "1" and 2 ^ (8 - i) or 0)
    end
    return string.char(c)
  end))
end
local function urldecode(s)
  return (string.gsub(s, "%%(%x%x)", function(h)
    return string.char(tonumber(h, 16))
  end))
end
local function address_in(value)
  if value == nil then return nil end
  local scheme, rest = string.match(value, "^(%a+)%s+(.+)$")
  if scheme ~= nil then
    if string.lower(scheme) == "basic" then
      local decoded = b64decode(rest)
      local colon = string.find(decoded, ":", 1, true)
      if colon ~= nil then
        rest = string.sub(decoded, colon + 1)
      else
        rest = decoded
      end
    end
    value = rest
  end
  if string.sub(value, 1, #PREFIX) ~= PREFIX then return nil end
  local id = string.sub(value, #PREFIX + 1)
  if string.match(id, "^[%w%._~%-]+$") == nil then return nil end
  return id
end
local function address_in_query(path)
  if path == nil then return nil end
  local qi = string.find(path, "?", 1, true)
  if qi == nil then return nil end
  for pair in string.gmatch(string.sub(path, qi + 1), "[^&]+") do
    local eq = string.find(pair, "=", 1, true)
    if eq ~= nil then
      local key = string.sub(pair, 1, eq - 1)
      for _, param in ipairs(PARAMS) do
        if key == param then
          local id = address_in(urldecode(string.sub(pair, eq + 1)))
          if id ~= nil then return id end
        end
      end
    end
  end
  return nil
end
function envoy_on_request(rh)
  local h = rh:headers()
  h:remove(ADDRESS_HEADER)
  local id = nil
  for _, name in ipairs(HEADERS) do
    id = address_in(h:get(name))
    if id ~= nil then break end
  end
  if id == nil then id = address_in_query(h:get(":path")) end
  if id ~= nil then
    h:add(ADDRESS_HEADER, id)
    rh:clearRouteCache()
  end
end
`

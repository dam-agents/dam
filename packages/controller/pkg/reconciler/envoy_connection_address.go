package reconciler

import (
	"sort"
	"strconv"
	"strings"
)

const (
	extensionWithMatcherType = "type.googleapis.com/envoy.extensions.common.matching.v3.ExtensionWithMatcher"
	requestHeaderInputType   = "type.googleapis.com/envoy.type.matcher.v3.HttpRequestHeaderMatchInput"
	skipFilterActionType     = "type.googleapis.com/envoy.extensions.filters.common.matcher.action.v3.SkipFilter"
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

func (c envoyHostChain) RivalsOf(cred envoyCredential) []string {
	if cred.ConnectionID == "" {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, other := range c.Credentials {
		if other.ConnectionID == "" || other.ConnectionID == cred.ConnectionID || seen[other.ConnectionID] {
			continue
		}
		if !strings.EqualFold(other.HeaderName, cred.HeaderName) {
			continue
		}
		seen[other.ConnectionID] = true
		out = append(out, other.ConnectionID)
	}
	sort.Strings(out)
	return out
}

func skippedForRivals(filter ev, innerName string, rivals []string) ev {
	if len(rivals) == 0 {
		return filter
	}
	skips := ev{}
	for _, rival := range rivals {
		skips[rival] = ev{"action": ev{"name": "skip", "typed_config": ev{"@type": skipFilterActionType}}}
	}
	return ev{
		"name": filter["name"],
		"typed_config": ev{
			"@type":            extensionWithMatcherType,
			"extension_config": ev{"name": innerName, "typed_config": filter["typed_config"]},
			"xds_matcher": ev{
				"matcher_tree": ev{
					"input": ev{
						"name":         "request-headers",
						"typed_config": ev{"@type": requestHeaderInputType, "header_name": connectionAddressHeader},
					},
					"exact_match_map": ev{"map": skips},
				},
			},
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

func contestedScopes(c envoyHostChain) []string {
	var out []string
	for _, scope := range c.PathScopes() {
		if c.ContestedAt(scope) {
			out = append(out, scope)
		}
	}
	return out
}

func luaStringList(items []string) string {
	quoted := make([]string, 0, len(items))
	for _, item := range items {
		quoted = append(quoted, strconv.Quote(item))
	}
	return "{" + strings.Join(quoted, ", ") + "}"
}

func luaContestedList(c envoyHostChain) string {
	entries := make([]string, 0)
	for _, scope := range contestedScopes(c) {
		entries = append(entries, "{scope = "+strconv.Quote(scope)+", body = "+strconv.Quote(refusedBody(c, scope))+"}")
	}
	return "{" + strings.Join(entries, ", ") + "}"
}

func luaConnectionAddressScript(c envoyHostChain) string {
	return "local HEADERS = " + luaStringList(claimedHeaderNames(c)) + "\n" +
		"local PARAMS = " + luaStringList(claimedQueryParams(c)) + "\n" +
		"local CONTESTED = " + luaContestedList(c) + "\n" +
		"local ADDRESS_HEADER = " + strconv.Quote(connectionAddressHeader) + "\n" +
		"local PREFIX = " + strconv.Quote(connectionEgressPlaceholderPrefix) + "\n" +
		"local PATH_SEGMENT = " + strconv.Quote(connectionEgressPathSegment) + "\n" +
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
local function address_in_path(path)
  if path == nil then return nil end
  local marker = "/" .. PATH_SEGMENT .. "/"
  if string.sub(path, 1, #marker) ~= marker then return nil end
  local rest = string.sub(path, #marker + 1)
  local slash = string.find(rest, "/", 1, true)
  if slash == nil then return nil end
  local id = string.sub(rest, 1, slash - 1)
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
local function refusal_for(path)
  for _, contested in ipairs(CONTESTED) do
    if string.sub(path, 1, #contested.scope) == contested.scope then
      return contested.body
    end
  end
  return nil
end
function envoy_on_request(rh)
  local h = rh:headers()
  h:remove(ADDRESS_HEADER)
  local path = h:get(":path") or "/"
  local id = address_in_path(path)
  if id == nil then
    for _, name in ipairs(HEADERS) do
      id = address_in(h:get(name))
      if id ~= nil then break end
    end
  end
  if id == nil then id = address_in_query(path) end
  if id ~= nil then
    h:add(ADDRESS_HEADER, id)
    rh:clearRouteCache()
    return
  end
  local body = refusal_for(path)
  if body ~= nil then
    rh:respond({[":status"] = "403", ["content-type"] = "text/plain"}, body)
  end
end
`

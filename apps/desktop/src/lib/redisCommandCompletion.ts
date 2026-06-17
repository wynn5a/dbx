import { classifyRedisCommandSafety } from "@/lib/redisCommandSafety";

export type RedisCompletionKind = "command" | "key";

export interface RedisCompletionItem {
  label: string;
  kind: RedisCompletionKind;
  detail?: string;
}

export interface RedisCommandSpec {
  name: string;
  syntax?: string;
  summary?: string;
}

/**
 * Curated catalog of the Redis commands worth completing in the command terminal.
 * Not exhaustive (Redis has 200+ commands) but covers the common day-to-day surface
 * across strings, hashes, lists, sets, sorted sets, streams, keyspace and connection.
 */
export const REDIS_COMMANDS: RedisCommandSpec[] = [
  // Connection / server
  { name: "PING", syntax: "PING [message]", summary: "Ping the server" },
  { name: "ECHO", syntax: "ECHO message", summary: "Echo the given string" },
  { name: "SELECT", syntax: "SELECT index", summary: "Change the selected database" },
  { name: "AUTH", syntax: "AUTH [username] password", summary: "Authenticate to the server" },
  { name: "INFO", syntax: "INFO [section]", summary: "Server information and statistics" },
  { name: "DBSIZE", syntax: "DBSIZE", summary: "Number of keys in the current database" },
  { name: "TIME", syntax: "TIME", summary: "Return the server time" },
  { name: "COMMAND", syntax: "COMMAND [subcommand]", summary: "Get details about Redis commands" },
  { name: "CLIENT", syntax: "CLIENT subcommand", summary: "Inspect and manage client connections" },

  // Generic keyspace
  { name: "GET", syntax: "GET key", summary: "Get the value of a key" },
  { name: "SET", syntax: "SET key value [EX seconds] [PX ms] [NX|XX]", summary: "Set the string value of a key" },
  { name: "GETSET", syntax: "GETSET key value", summary: "Set a key and return its old value" },
  { name: "GETDEL", syntax: "GETDEL key", summary: "Get the value of a key and delete it" },
  { name: "GETEX", syntax: "GETEX key [EX seconds|PERSIST]", summary: "Get value and optionally set expiry" },
  { name: "SETEX", syntax: "SETEX key seconds value", summary: "Set value and expiry in seconds" },
  { name: "PSETEX", syntax: "PSETEX key ms value", summary: "Set value and expiry in milliseconds" },
  { name: "SETNX", syntax: "SETNX key value", summary: "Set value only if key does not exist" },
  { name: "APPEND", syntax: "APPEND key value", summary: "Append a value to a key" },
  { name: "STRLEN", syntax: "STRLEN key", summary: "Length of the string value" },
  { name: "MGET", syntax: "MGET key [key ...]", summary: "Get the values of multiple keys" },
  { name: "MSET", syntax: "MSET key value [key value ...]", summary: "Set multiple keys" },
  { name: "MSETNX", syntax: "MSETNX key value [key value ...]", summary: "Set multiple keys if none exist" },
  { name: "INCR", syntax: "INCR key", summary: "Increment the integer value by one" },
  { name: "DECR", syntax: "DECR key", summary: "Decrement the integer value by one" },
  { name: "INCRBY", syntax: "INCRBY key increment", summary: "Increment by the given amount" },
  { name: "DECRBY", syntax: "DECRBY key decrement", summary: "Decrement by the given amount" },
  { name: "INCRBYFLOAT", syntax: "INCRBYFLOAT key increment", summary: "Increment by a float amount" },
  { name: "DEL", syntax: "DEL key [key ...]", summary: "Delete one or more keys" },
  { name: "UNLINK", syntax: "UNLINK key [key ...]", summary: "Delete keys asynchronously" },
  { name: "EXISTS", syntax: "EXISTS key [key ...]", summary: "Determine if keys exist" },
  { name: "TYPE", syntax: "TYPE key", summary: "Determine the type stored at key" },
  { name: "KEYS", syntax: "KEYS pattern", summary: "Find all keys matching a pattern" },
  { name: "SCAN", syntax: "SCAN cursor [MATCH pattern] [COUNT n]", summary: "Incrementally iterate keys" },
  { name: "RENAME", syntax: "RENAME key newkey", summary: "Rename a key" },
  { name: "RENAMENX", syntax: "RENAMENX key newkey", summary: "Rename a key if newkey does not exist" },
  { name: "RANDOMKEY", syntax: "RANDOMKEY", summary: "Return a random key" },
  { name: "TTL", syntax: "TTL key", summary: "Time to live in seconds" },
  { name: "PTTL", syntax: "PTTL key", summary: "Time to live in milliseconds" },
  { name: "EXPIRE", syntax: "EXPIRE key seconds", summary: "Set a key's TTL in seconds" },
  { name: "PEXPIRE", syntax: "PEXPIRE key ms", summary: "Set a key's TTL in milliseconds" },
  { name: "EXPIREAT", syntax: "EXPIREAT key timestamp", summary: "Set expiry as a UNIX timestamp" },
  { name: "PEXPIREAT", syntax: "PEXPIREAT key ms-timestamp", summary: "Set expiry as a ms timestamp" },
  { name: "PERSIST", syntax: "PERSIST key", summary: "Remove the expiry from a key" },
  { name: "DUMP", syntax: "DUMP key", summary: "Serialized version of the value" },
  { name: "OBJECT", syntax: "OBJECT subcommand key", summary: "Inspect internals of a key" },

  // Hash
  { name: "HGET", syntax: "HGET key field", summary: "Get the value of a hash field" },
  { name: "HSET", syntax: "HSET key field value [field value ...]", summary: "Set hash field(s)" },
  { name: "HSETNX", syntax: "HSETNX key field value", summary: "Set a hash field if not exists" },
  { name: "HMGET", syntax: "HMGET key field [field ...]", summary: "Get values of multiple fields" },
  { name: "HGETALL", syntax: "HGETALL key", summary: "Get all fields and values" },
  { name: "HDEL", syntax: "HDEL key field [field ...]", summary: "Delete hash field(s)" },
  { name: "HEXISTS", syntax: "HEXISTS key field", summary: "Determine if a hash field exists" },
  { name: "HKEYS", syntax: "HKEYS key", summary: "Get all hash field names" },
  { name: "HVALS", syntax: "HVALS key", summary: "Get all hash values" },
  { name: "HLEN", syntax: "HLEN key", summary: "Number of fields in a hash" },
  { name: "HINCRBY", syntax: "HINCRBY key field increment", summary: "Increment a hash field (int)" },
  { name: "HINCRBYFLOAT", syntax: "HINCRBYFLOAT key field increment", summary: "Increment a hash field (float)" },
  { name: "HSCAN", syntax: "HSCAN key cursor [MATCH pattern]", summary: "Incrementally iterate a hash" },

  // List
  { name: "LPUSH", syntax: "LPUSH key value [value ...]", summary: "Prepend value(s) to a list" },
  { name: "RPUSH", syntax: "RPUSH key value [value ...]", summary: "Append value(s) to a list" },
  { name: "LPUSHX", syntax: "LPUSHX key value", summary: "Prepend only if the list exists" },
  { name: "RPUSHX", syntax: "RPUSHX key value", summary: "Append only if the list exists" },
  { name: "LPOP", syntax: "LPOP key [count]", summary: "Remove and get the first element(s)" },
  { name: "RPOP", syntax: "RPOP key [count]", summary: "Remove and get the last element(s)" },
  { name: "LRANGE", syntax: "LRANGE key start stop", summary: "Get a range of list elements" },
  { name: "LLEN", syntax: "LLEN key", summary: "Length of a list" },
  { name: "LINDEX", syntax: "LINDEX key index", summary: "Get an element by index" },
  { name: "LSET", syntax: "LSET key index value", summary: "Set the value of an element by index" },
  { name: "LREM", syntax: "LREM key count value", summary: "Remove elements equal to value" },
  { name: "LTRIM", syntax: "LTRIM key start stop", summary: "Trim a list to a range" },
  { name: "LINSERT", syntax: "LINSERT key BEFORE|AFTER pivot value", summary: "Insert relative to a pivot" },

  // Set
  { name: "SADD", syntax: "SADD key member [member ...]", summary: "Add member(s) to a set" },
  { name: "SREM", syntax: "SREM key member [member ...]", summary: "Remove member(s) from a set" },
  { name: "SMEMBERS", syntax: "SMEMBERS key", summary: "Get all set members" },
  { name: "SISMEMBER", syntax: "SISMEMBER key member", summary: "Determine if a member is in a set" },
  { name: "SCARD", syntax: "SCARD key", summary: "Number of members in a set" },
  { name: "SPOP", syntax: "SPOP key [count]", summary: "Remove and return random member(s)" },
  { name: "SRANDMEMBER", syntax: "SRANDMEMBER key [count]", summary: "Return random member(s)" },
  { name: "SINTER", syntax: "SINTER key [key ...]", summary: "Intersect multiple sets" },
  { name: "SUNION", syntax: "SUNION key [key ...]", summary: "Union of multiple sets" },
  { name: "SDIFF", syntax: "SDIFF key [key ...]", summary: "Difference of multiple sets" },
  { name: "SSCAN", syntax: "SSCAN key cursor [MATCH pattern]", summary: "Incrementally iterate a set" },

  // Sorted set
  { name: "ZADD", syntax: "ZADD key score member [score member ...]", summary: "Add member(s) to a sorted set" },
  { name: "ZREM", syntax: "ZREM key member [member ...]", summary: "Remove member(s) from a sorted set" },
  { name: "ZSCORE", syntax: "ZSCORE key member", summary: "Get the score of a member" },
  { name: "ZRANK", syntax: "ZRANK key member", summary: "Index of a member (ascending)" },
  { name: "ZREVRANK", syntax: "ZREVRANK key member", summary: "Index of a member (descending)" },
  { name: "ZRANGE", syntax: "ZRANGE key start stop [WITHSCORES]", summary: "Range of members by index" },
  { name: "ZREVRANGE", syntax: "ZREVRANGE key start stop [WITHSCORES]", summary: "Reverse range by index" },
  { name: "ZRANGEBYSCORE", syntax: "ZRANGEBYSCORE key min max", summary: "Range of members by score" },
  { name: "ZCARD", syntax: "ZCARD key", summary: "Number of members in a sorted set" },
  { name: "ZCOUNT", syntax: "ZCOUNT key min max", summary: "Count members within a score range" },
  { name: "ZINCRBY", syntax: "ZINCRBY key increment member", summary: "Increment the score of a member" },
  { name: "ZSCAN", syntax: "ZSCAN key cursor [MATCH pattern]", summary: "Incrementally iterate a sorted set" },

  // Stream
  { name: "XADD", syntax: "XADD key * field value [field value ...]", summary: "Append an entry to a stream" },
  { name: "XLEN", syntax: "XLEN key", summary: "Number of entries in a stream" },
  { name: "XRANGE", syntax: "XRANGE key start end [COUNT n]", summary: "Range of stream entries" },
  { name: "XREAD", syntax: "XREAD [COUNT n] STREAMS key id", summary: "Read from one or more streams" },
  { name: "XDEL", syntax: "XDEL key id [id ...]", summary: "Remove entries from a stream" },
];

const COMMAND_BY_NAME = new Map(REDIS_COMMANDS.map((spec) => [spec.name, spec]));

const MAX_COMMAND_RESULTS = 50;
const MAX_KEY_RESULTS = 50;

export interface RedisCompletionToken {
  /** Index in `text` where the token under the caret starts. */
  start: number;
  /** Index in `text` where the token under the caret ends (the caret position). */
  end: number;
  /** The token text from `start` up to the caret. */
  value: string;
  /** True when this token is the command name (the first token of the command). */
  isFirstToken: boolean;
}

/**
 * Find the whitespace-delimited token under the caret and whether it is the first
 * token of the command (i.e. the command name vs. an argument).
 */
export function getRedisCompletionToken(text: string, caret: number): RedisCompletionToken {
  const pos = Math.max(0, Math.min(caret, text.length));

  let start = pos;
  while (start > 0 && !/\s/.test(text[start - 1])) {
    start -= 1;
  }

  const isFirstToken = /^\s*$/.test(text.slice(0, start));
  return {
    start,
    end: pos,
    value: text.slice(start, pos),
    isFirstToken,
  };
}

function commandDetail(spec: RedisCommandSpec): string | undefined {
  const isWrite = classifyRedisCommandSafety(spec.name) === "confirm";
  const parts: string[] = [];
  if (spec.summary) parts.push(spec.summary);
  if (isWrite) parts.push("(write)");
  return parts.length > 0 ? parts.join(" ") : spec.syntax;
}

/**
 * Rank matches so that prefix matches come before substring matches, then sort
 * alphabetically within each group. `query` is expected to be upper-cased already
 * for commands; pass the raw casing for keys.
 */
function rankByPrefix<T>(items: T[], query: string, labelOf: (item: T) => string): T[] {
  if (!query) return items.slice();
  const lower = query.toLowerCase();
  const scored: { item: T; score: number; label: string }[] = [];
  for (const item of items) {
    const label = labelOf(item);
    const idx = label.toLowerCase().indexOf(lower);
    if (idx < 0) continue;
    scored.push({ item, score: idx === 0 ? 0 : 1, label });
  }
  scored.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label));
  return scored.map((entry) => entry.item);
}

/**
 * Build the completion items for the token under the caret.
 *
 * - First token → match against the Redis command catalog.
 * - Argument token → match against known key names (sourced from a SCAN cache).
 *
 * Returns an empty list when there is nothing useful to suggest (e.g. an empty
 * argument token, which would otherwise dump the entire key space).
 */
export function buildRedisCompletionItems(text: string, caret: number, keyNames: string[]): RedisCompletionItem[] {
  const token = getRedisCompletionToken(text, caret);

  if (token.isFirstToken) {
    const query = token.value.toUpperCase();
    const matches = rankByPrefix(REDIS_COMMANDS, query, (spec) => spec.name).slice(0, MAX_COMMAND_RESULTS);
    return matches.map((spec) => ({
      label: spec.name,
      kind: "command" as const,
      detail: commandDetail(spec),
    }));
  }

  // Argument position: suggest known keys. Avoid dumping everything on an empty token.
  if (!token.value) return [];
  const matches = rankByPrefix(keyNames, token.value, (name) => name).slice(0, MAX_KEY_RESULTS);
  return matches.map((name) => ({ label: name, kind: "key" as const }));
}

/**
 * Replace the token under the caret with `label`, returning the new input text and
 * the caret position after insertion. Command completions get a trailing space so the
 * user can keep typing arguments; key completions do not.
 */
export function applyRedisCompletion(
  text: string,
  caret: number,
  item: RedisCompletionItem,
): { text: string; caret: number } {
  const token = getRedisCompletionToken(text, caret);
  const insert = item.kind === "command" && COMMAND_BY_NAME.has(item.label) ? `${item.label} ` : item.label;
  const next = text.slice(0, token.start) + insert + text.slice(token.end);
  return { text: next, caret: token.start + insert.length };
}

let caretMirror: HTMLDivElement | null = null;

/**
 * Measure the horizontal pixel offset of the caret inside a single-line `<input>`,
 * relative to the input's left content edge. Uses a hidden mirror element that
 * replicates the input's typography so the completion menu can track the caret.
 */
export function measureInputCaretLeft(input: HTMLInputElement, caret: number): number {
  if (typeof document === "undefined") return 0;

  if (!caretMirror) {
    caretMirror = document.createElement("div");
    caretMirror.setAttribute("aria-hidden", "true");
    const s = caretMirror.style;
    s.position = "absolute";
    s.top = "0";
    s.left = "0";
    s.visibility = "hidden";
    s.whiteSpace = "pre";
    s.pointerEvents = "none";
    document.body.appendChild(caretMirror);
  }

  const computed = window.getComputedStyle(input);
  const mirror = caretMirror;
  for (const prop of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing"] as const) {
    mirror.style[prop] = computed[prop];
  }

  const value = input.value.slice(0, Math.max(0, Math.min(caret, input.value.length)));
  // Use a non-collapsing representation for trailing spaces (whiteSpace: pre handles it).
  mirror.textContent = value;
  return mirror.offsetWidth;
}

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

import redis.asyncio as redis

# Maximum wrong guesses before loss; win is allowed on any attempt 1..MAX_GUESS_ATTEMPTS inclusive.
MAX_GUESS_ATTEMPTS = 6
GAME_STATE_TTL_SECONDS = 86400 * 14

GAME_STATE_KEY_PREFIX = "game_state:"


def game_state_redis_key(session_id: uuid.UUID, game_id: uuid.UUID) -> str:
    return f"{GAME_STATE_KEY_PREFIX}{session_id}:{game_id}"


@dataclass(frozen=True, slots=True)
class GuessStateResult:
    attempts: int
    status: str
    won_transition: bool
    last_guess_correct: bool
    terminal_replay: bool


_GUESS_LUA = """
local cjson = cjson
local key = KEYS[1]
local guessed = ARGV[1]
local correct = ARGV[2]
local max_a = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local raw = redis.call('GET', key)
local attempts = 0
local prev_status = 'PLAYING'

if raw then
  local st = cjson.decode(raw)
  attempts = tonumber(st.attempts) or 0
  prev_status = st.status or 'PLAYING'
end

if prev_status == 'WON' or prev_status == 'LOST' then
  return cjson.encode({
    attempts = attempts,
    status = prev_status,
    won_transition = false,
    last_guess_correct = (prev_status == 'WON'),
    terminal_replay = true
  })
end

attempts = attempts + 1
local correct_guess = (guessed == correct)

local new_status = 'PLAYING'
if correct_guess then
  new_status = 'WON'
elseif attempts >= max_a then
  new_status = 'LOST'
else
  new_status = 'PLAYING'
end

local to_store = {attempts = attempts, status = new_status}
redis.call('SET', key, cjson.encode(to_store))
redis.call('EXPIRE', key, ttl)

local won_transition = (prev_status == 'PLAYING' and new_status == 'WON')

return cjson.encode({
  attempts = attempts,
  status = new_status,
  won_transition = won_transition,
  last_guess_correct = correct_guess,
  terminal_replay = false
})
"""


def _parse_guess_result(payload: Any) -> GuessStateResult:
    if isinstance(payload, str):
        data = json.loads(payload)
    elif isinstance(payload, dict):
        data = payload
    else:
        raise ValueError("unexpected Lua return type")
    return GuessStateResult(
        attempts=int(data["attempts"]),
        status=str(data["status"]),
        won_transition=bool(data["won_transition"]),
        last_guess_correct=bool(data["last_guess_correct"]),
        terminal_replay=bool(data["terminal_replay"]),
    )


async def apply_guess(
    redis_client: redis.Redis,
    state_key: str,
    *,
    guessed_tidal_track_id: str,
    correct_tidal_track_id: str,
    max_attempts: int = MAX_GUESS_ATTEMPTS,
    ttl_seconds: int = GAME_STATE_TTL_SECONDS,
) -> GuessStateResult:
    raw = await redis_client.eval(
        _GUESS_LUA,
        1,
        state_key,
        guessed_tidal_track_id,
        correct_tidal_track_id,
        str(max_attempts),
        str(ttl_seconds),
    )
    return _parse_guess_result(raw)


def score_for_win(attempts_used: int, max_attempts: int = MAX_GUESS_ATTEMPTS) -> int:
    """Higher score for fewer attempts (only defined for winning games)."""
    return 100 * (max_attempts + 1 - attempts_used)

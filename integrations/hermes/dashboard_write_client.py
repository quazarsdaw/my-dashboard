"""закрытый https-транспорт writer; никаких путей или rpc из аргументов модели."""

import datetime as dt
import hashlib
import http.client
import json
import pathlib
import re
import ssl
import urllib.error
import urllib.request

from dashboard_mcp import ConnectorError, NoRedirect, PROJECT, validate_config

MAX_REQUEST = 32768
MAX_RESPONSE = 1024 * 1024
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
ENDPOINT = PROJECT + r"/functions/v1/dashboard-write"
ERRORS = {
    "unauthorized_or_expired": 401, "write_disabled": 403, "request_unknown": 404,
    "request_mismatch": 409, "conflict": 409, "request_retired": 410,
    "draft_expired": 410, "draft_cancelled": 410, "invalid_change": 422,
    "preview_too_large": 422, "request_too_large": 413, "rate_limited": 429,
    "upstream_unavailable": 502,
}
SCHEMAS = json.loads(pathlib.Path(__file__).with_name("dashboard_write_schemas.json").read_text(encoding="utf-8"))
OPTIONS = "get_edit_options"


class WriteClientError(Exception):
    """только фиксированный код, без содержимого provider-ответа."""


def json_text(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def refuse_nonfinite(_value):
    raise ValueError("invalid json number")


def check_config(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get("endpoint"), str) or not re.fullmatch(ENDPOINT, raw["endpoint"]):
        raise WriteClientError("invalid_config")
    try:
        validate_config({**raw, "endpoint": raw["endpoint"].removesuffix("-write") + "-read"})
    except ConnectorError:
        raise WriteClientError("invalid_config") from None
    return dict(raw)


def read_config(path):
    path = pathlib.Path(path)
    if not path.is_absolute() or path.is_symlink():
        raise WriteClientError("invalid_config")
    try:
        with path.open("rb") as stream:
            content = stream.read(16385)
        if len(content) > 16384:
            raise ValueError()
        return check_config(json.loads(content, parse_constant=refuse_nonfinite))
    except (ValueError, OSError, UnicodeError, RecursionError):
        raise WriteClientError("invalid_config") from None


def parse_timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise WriteClientError("upstream_unavailable")
    try:
        stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            raise ValueError()
        return stamp
    except (ValueError, OverflowError):
        raise WriteClientError("upstream_unavailable") from None


def valid_uuid(value):
    return isinstance(value, str) and UUID.fullmatch(value) is not None


def validate_receipt(value, request_id, draft_id=None):
    if (not isinstance(value, dict) or value.get("outcome") != "committed" or
            value.get("requestId") != request_id or not valid_uuid(value.get("draftId")) or
            (draft_id is not None and value["draftId"] != draft_id) or
            not isinstance(value.get("operation"), str) or value["operation"] not in SCHEMAS or
            not isinstance(value.get("targetId"), str) or not 1 <= len(value["targetId"]) <= 200):
        raise WriteClientError("upstream_unavailable")
    parse_timestamp(value.get("committedAt"))
    versions = value.get("versions")
    if not isinstance(versions, dict) or not 1 <= len(versions) <= 2 or any(
            not re.fullmatch(r"inbox_v1|backlog_tasks_v1|horizons_goals_v2|goals:\d{4}-\d{2}-\d{2}", key)
            or not isinstance(revision, str) or not re.fullmatch(r"[1-9][0-9]{0,18}", revision)
            or int(revision) > 9223372036854775807 for key, revision in versions.items()):
        raise WriteClientError("upstream_unavailable")
    location = value.get("location", {})
    if not isinstance(location, dict) or any(k not in ("date", "horizon", "periodKey") or
            not isinstance(v, str) or len(v) > 20 for k, v in location.items()):
        raise WriteClientError("upstream_unavailable")
    return {k: value[k] for k in ("outcome", "requestId", "draftId", "operation", "targetId", "committedAt", "versions")} | {
        "location": location,
    }


class WriteClient:
    def __init__(self, config):
        self._config = check_config(config)
        self.generation = hashlib.sha256(self._config["token"].encode()).hexdigest()
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))

    def _call(self, route, body):
        try:
            raw = json_text(body).encode("utf-8")
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise WriteClientError("invalid_change") from None
        if len(raw) > MAX_REQUEST:
            raise WriteClientError("request_too_large")
        config = self._config
        req = urllib.request.Request(config["endpoint"] + "/" + route, data=raw, method="POST", headers={
            "Content-Type": "application/json", "Accept": "application/json",
            "Authorization": "Bearer " + config["anon_key"], "apikey": config["anon_key"],
            "X-Dashboard-Write-Token": config["token"],
        })
        try:
            with self.opener.open(req, timeout=20) as response:
                if response.status != 200 or response.headers.get("content-type", "").split(";")[0].lower() != "application/json":
                    raise WriteClientError("upstream_unavailable")
                raw = response.read(MAX_RESPONSE + 1)
                if len(raw) > MAX_RESPONSE:
                    raise WriteClientError("upstream_unavailable")
                result = json.loads(raw, parse_constant=refuse_nonfinite)
                if not isinstance(result, dict) or "error" in result:
                    raise WriteClientError("upstream_unavailable")
                return result
        except urllib.error.HTTPError as error:
            with error:
                try:
                    result = json.loads(error.read(4097), parse_constant=refuse_nonfinite)
                    code = result.get("error") if isinstance(result, dict) else None
                except (ValueError, OSError, UnicodeError, RecursionError, http.client.HTTPException):
                    code = None
            if isinstance(code, str) and ERRORS.get(code) == error.code:
                raise WriteClientError(code) from None
            raise WriteClientError("upstream_unavailable") from None
        except (OSError, ValueError, UnicodeError, RecursionError, http.client.HTTPException):
            raise WriteClientError("upstream_unavailable") from None

    def prepare(self, request_id, operation, args):
        result = self._call("prepare", {"requestId": request_id, "operation": operation, "arguments": args})
        if result.get("state") == "committed":
            return {"state": "committed", "receipt": validate_receipt(result.get("receipt"), request_id)}
        draft = result.get("draft")
        if (result.get("state") != "prepared" or not isinstance(draft, dict)
                or draft.get("requestId") != request_id or not valid_uuid(draft.get("draftId"))):
            raise WriteClientError("upstream_unavailable")
        preview = draft.get("previewText")
        if not isinstance(preview, str) or not preview or len(preview.encode("utf-16-le", errors="surrogatepass")) > 5000:
            raise WriteClientError("upstream_unavailable")
        parse_timestamp(draft.get("expiresAt"))
        return {"state": "prepared", "draft": {k: draft[k] for k in ("requestId", "draftId", "expiresAt", "previewText")}}

    def commit(self, request_id, draft_id):
        return validate_receipt(self._call("commit", {"requestId": request_id, "draftId": draft_id}), request_id, draft_id)

    def status(self, request_id):
        result = self._call("status", {"requestId": request_id})
        if result.get("requestId") != request_id or not valid_uuid(result.get("draftId")):
            raise WriteClientError("upstream_unavailable")
        state = result.get("state")
        if state not in ("committed", "prepared", "cancelled", "expired", "conflicted"):
            raise WriteClientError("upstream_unavailable")
        summary = {k: result[k] for k in ("requestId", "draftId", "state")}
        if state == "committed":
            if result.get("receipt_expired") is True:
                minimal = validate_receipt({**result, "outcome": "committed"}, request_id, result["draftId"])
                return {**summary, "receipt_expired": True, **minimal}
            return {**summary, "receipt": validate_receipt(result.get("receipt"), request_id, result["draftId"])}
        return summary

    def cancel(self, request_id, draft_id):
        result = self._call("cancel", {"requestId": request_id, "draftId": draft_id})
        if result.get("requestId") != request_id or result.get("draftId") != draft_id:
            raise WriteClientError("upstream_unavailable")
        return result.get("state")

    def options(self):
        return self._call("options", {})

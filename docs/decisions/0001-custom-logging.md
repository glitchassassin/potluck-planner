# 0001: Use a custom logger with Remix's logging interface

Status: Accepted

## Context

The app runs in a container and needs structured logs on stdout, configurable severity and request detail, and phone-number masking that applies at every level. We also want request IDs, request timing, and optional browser-visible timing headers. We do not want additional production dependencies.

Remix 3.2 includes `remix/middleware/logger`. It provides request metadata, duration, configurable text formatting, a custom output callback, and access through `context.logger` or `context.get(Logger)`.

Its output callback receives a formatted string. It does not provide structured fields, severity filtering, or phone-number masking. Its duration measures the time until downstream middleware returns a `Response`. A streaming response can continue generating and sending its body after that point. The middleware does not track Node's response completion or aborted-response events.

## Decision

Maintain a small application-owned logger and HTTP instrumentation layer using Remix and Node's built-in APIs. Keep Remix as the only production dependency.

Preserve Remix's logging interface: register `logger()` or `logger({ log })`, call `context.logger(message)`, and reuse Remix's existing `Logger` context key. Extend the callback with optional structured fields and severity. The output remains JSON lines rather than Remix's token-formatted text.

Use Node's async context to correlate application logs with a generated request ID, returned as `X-Request-ID`. Measure elapsed time with a monotonic clock. Record handler duration separately from the duration until Node hands the response to the operating system. Record aborted responses separately; neither duration measures when the browser finishes receiving the response.

Mask US phone numbers in string values to their last two digits, including nested application log fields and log messages. Convert bigint values to decimal strings and replace circular references with `[Circular]` so these fields can be logged as JSON. Leave other values unchanged. Request path and query parameters are logged without phone masking, including repeated query values. There is no field-name-based redaction or special error sanitization; HTTP errors are logged as strings and receive the same phone masking.

Configure severity through `LOG_LEVEL` (`debug`, `info`, `warn`, `error`, or `silent`; default `info`) and request detail through `REQUEST_LOG_DETAIL` (default `summary`). Both request detail and `SERVER_TIMING` accept `off`, `summary`, and `detailed`. Browser-visible `Server-Timing` headers default to `off`; detailed mode includes explicitly instrumented operation durations.

## Alternatives and consequences

Using Remix's logger with a custom output callback would still require our own severity, phone masking, request correlation, and response-lifecycle handling. Formatting metadata as text and then parsing it back into structured fields adds work without covering those requirements. A separate logging library would introduce a production dependency.

We own the implementation and its tests, including concurrent request isolation, masking, streaming failures, and aborted responses. Reusing Remix's interface keeps application logging familiar, but this is not a complete replacement for its formatting options. Revisit the decision if Remix gains structured logging and response-lifecycle instrumentation that cover these requirements.

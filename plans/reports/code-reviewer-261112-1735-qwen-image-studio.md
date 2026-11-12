# Review 1 – qwen-image-studio (condensed)

Status: findings fixed, re-review pending.

| Id | Sev | Finding | Resolution |
|----|-----|---------|-----------|
| C1 | Critical | Any web page could drive the local API (CSRF / DNS rebinding) and make the server send the stored API key to an attacker-chosen endpoint | Host/Origin allowlist (`request-guard.ts`), JSON content-type required, stored key reused only for the origin it was saved with |
| H1 | High | Same root cause via project override + key-less test | Same-origin key reuse (`reusableKey`) in all credential routes |
| M1 | Med | Unbounded image download | Content-length precheck + streamed 50MB cap |
| M2 | Med | Partial download failure lost successful images/cost | `allSettled`; keep successes, note failures |
| M3 | Med | Files written for a run whose task was deleted | `runExists` check + mkdir immediately before write |
| M4 | Med | No cap on refs per task | 10 refs, 40MB total |
| L1-L8 | Low | Short-key masking, credentials file mode, URI decode 500, reorder/save races, poll 404 loop, chip regex drift | Fixed (see code) |

Not fixed (accepted): in-flight upstream fetch is not aborted on delete (only file writes are guarded); redirects on image download unrestricted; a user-typed literal chip token is treated as a chip.

# Hunt categories

One worker per category (or per category and component). Paste the relevant block into the brief. Each block lists the questions to answer and the sinks to search for. Search patterns are starting points; read the code around every hit.

## Access control

- Does every entry point from the map check who the caller is (authentication) and what they may do (authorization)?
- Object-level checks: when a handler loads a record by ID, does it check the record belongs to the caller's user, tenant or org? (IDOR)
- Are admin, debug, health, metrics and internal routes reachable without auth?
- Do background jobs, webhooks and MCP tools run with more privilege than the caller who triggered them?
- Search: route decorators, `@router.`, `app.get(`, `permission`, `is_admin`, `tenant_id`, `org_id`, `owner_id`, `get_current_user`, `Depends(`.

## Injection

- SQL: raw strings or f-strings into `execute(`, `text(`, `raw(`, `.query(`; ORDER BY or LIMIT built from input.
- Shell: `subprocess` with `shell=True`, `os.system`, `exec(`, `child_process.exec`, backticks, `bash -c` with interpolation.
- Templates: user input into template source (`render_template_string`, `Template(`, `new Function(`), or HTML without escaping (`dangerouslySetInnerHTML`, `|safe`, `v-html`, `innerHTML`).
- Paths: user input in file paths without normalization and a base-folder check (`open(`, `send_file`, `path.join(` with `..`); archive extraction (zip slip).
- Query languages: LDAP, XPath, NoSQL operators (`$where`, `$regex`), search DSLs, log queries built from input.

## Secrets and crypto

- Hardcoded keys, tokens, passwords, private keys, connection strings (also in tests, fixtures, notebooks, `.env.example` with real values, CI files).
- Secrets written to logs, error messages, traces, analytics or API responses.
- Weak or misused crypto: MD5 or SHA1 for passwords, no salt, ECB mode, static IVs, `random` instead of `secrets`, JWT `alg: none` or no signature check, missing token expiry.
- TLS checks off: `verify=False`, `rejectUnauthorized: false`, `InsecureSkipVerify`.

## Input handling and deserialization

- Unsafe deserialization: `pickle.loads`, `yaml.load` without SafeLoader, `marshal`, Java or .NET binary serializers, `node-serialize`.
- Mass assignment: request bodies mapped straight onto models (role, is_admin, tenant fields).
- Missing size and count limits: uploads, JSON bodies, regexes open to catastrophic backtracking (ReDoS), pagination without a maximum.
- File uploads: type checked by extension only, stored under a guessable public path, served with the user's content type.

## SSRF and outbound calls

- Does any code fetch a URL, host or IP that comes from the user, a webhook, a document or a model output?
- Is there an allow-list, and does it block redirects to internal addresses, cloud metadata (169.254.169.254), localhost and private ranges after DNS resolution?
- Search: `requests.get(`, `httpx`, `fetch(`, `axios`, `urlopen`, `curl`, webhook URL fields, "import from URL" features.

## Supply chain and CI

- Dependencies with known vulnerabilities (scanner output), unpinned versions, install scripts from unknown packages, dependency confusion (internal names resolvable on public registries).
- GitHub Actions: `pull_request_target` with a checkout of the PR head, `${{ github.event.* }}` interpolated into `run:` (script injection), actions pinned to tags instead of SHAs, `permissions:` broader than needed, secrets exposed to forked PRs.
- Docker: running as root, `latest` tags, secrets in build args or layers, `curl | sh` in builds.

## Config and infrastructure

- Helm, Kubernetes, Terraform, compose: privileged containers, host paths, host network, broad RBAC or IAM (`*` actions), public buckets, open security groups, missing network policies, default passwords.
- App config: debug mode on, permissive CORS (`*` with credentials), missing security headers, cookies without `Secure`/`HttpOnly`/`SameSite`, CSRF protection off.
- Services bound to `0.0.0.0` that should be local only.

## LLM and agent risks

- Prompt injection: can untrusted text (tickets, emails, logs, web pages, documents, tool output) reach a model that can call tools with side effects? Trace from the untrusted source to each tool.
- Tool scope: do agent tools run with the user's privileges or more? Can a tool read or write outside its intended scope (arbitrary file paths, arbitrary SQL, arbitrary URLs)?
- Approval gates: which actions run without a human approval, and can model output change what gets approved?
- Model output used as code or commands: `eval`, shell, SQL or file paths built from model output.
- MCP servers: exposed on a network port without auth, tools with broad side effects, secrets passed through tool arguments or results.
- Data leaks: secrets or customer data placed in prompts sent to third-party models, or kept in logs and traces.

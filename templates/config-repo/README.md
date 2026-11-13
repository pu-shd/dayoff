# Day Off deployment configuration

Keep this repository **private**. It contains personal settings and original attendance workbooks. The reusable application lives in the public repository pinned by `app.lock.json`. The Apps Script project and deployment identifiers in `target.json` are nonsecret routing metadata; OAuth credentials stay outside Git.

`config.json` holds owner, reporting recipients, Calendar ID, holidays and policy. `sources/workbooks/` holds original Excel files with their original names and bytes. `sources/inventory.json` records their fiscal years and SHA-256 hashes. The filename supplies the fiscal year even when a workbook's internal header is stale. The manifest identifies the current workbook through its FY and the latest history anchor.

```sh
./scripts/test.sh
./scripts/bootstrap.sh --dry-run
./scripts/bootstrap.sh
./scripts/deploy.sh --dry-run
./scripts/deploy.sh
```

Requirements: macOS/zsh or Linux/zsh, Node 24.11.1+, uv 0.9.5+, Docker and docker-compose. Bootstrap obtains the exact public-code revision, installs locked dependencies into ignored `local/app`, and regenerates the current-year seed and multi-year archive there. It binds the existing target and never creates a second app or ledger. Its Python environment is `local/app/.venv`. It reuses normal local clasp authentication, or `clasp_config_auth` pointing to a credential file outside this repository.

Use `./scripts/update.sh` after reviewing and committing configuration changes. To change public code, choose and review a full commit SHA and use `./scripts/build.sh --app-revision FULL_SHA`. Test, commit the updated `app.lock.json` privately, then run `./scripts/update.sh`. A public-code push alone does not redeploy this instance. Generated imports, `.env`, `.clasp.json`, bundles, credentials and the application checkout remain ignored.

The tests run private settings/inventory validation and source collation with read-only mounts, plus the public application's full containerized suite. Source files are excluded from image build contexts and are never published as artifacts. Checks print pass/fail status and counts, not attendance values. The original workbooks are preserved; changed source files require review and `./scripts/inventory.sh` before commit. Updating a workbook does not rewrite already-imported ledger charges. Review active-year corrections separately.

To tear down the web deployment while retaining the ledger and source files, review `./scripts/teardown.sh --dry-run`, then run `./scripts/teardown.sh`. Delivery is disabled before deployment removal. Do not use teardown merely to update code or settings.

## Optional GitOps deployment

Checks run on every push and pull request. Deployment is disabled until repository variable `DAYOFF_GITOPS_ENABLED` is `true`. To enable it, create a GitHub environment named `dayoff`, add only the `CLASP_AUTH_JSON` environment secret from a private credential file using stdin, then set that variable. Keep authentication out of command-line arguments, commits and workflow output. No credentials are copied automatically.

The workflow tests the pinned application and private source files before deploying changes on main. Manual dispatch permits deploy/teardown and defaults to dry run. Concurrent deployments are serialized. Private settings and workbooks come from this repository; they do not need duplicate configuration or source-data secrets. Runtime credentials and generated files are removed after the deployment job.

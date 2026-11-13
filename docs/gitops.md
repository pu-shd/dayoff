# CLI and GitOps operation

Bootstrap once from a trusted workstation using the README. The pinned clasp CLI creates the project, pushes the bundle and creates an owner-only deployment. Its ID is saved privately in local/deployment.json and reused for updates.

```sh
./scripts/deploy.sh --dry-run
./scripts/deploy.sh
./scripts/update.sh --dry-run
./scripts/update.sh
./scripts/teardown.sh --dry-run
./scripts/teardown.sh YOUR_DEPLOYMENT_ID
```

Teardown first pushes disabled-delivery source, making existing time-driven reminder triggers inert, then removes the selected web deployment. It retains the private ledger and original local configuration. You can remove triggers in the app before teardown for complete trigger cleanup. Re-deploying the original live configuration deliberately re-enables any retained reminder triggers.

## Optional GitHub Actions deployment

The Apps Script deployment workflow is disabled unless the repository variable DAYOFF_GITOPS_ENABLED is true. No personal credentials are added to GitHub automatically.

After CLI bootstrap, create a GitHub environment named dayoff. Add these encrypted environment secrets:

| Secret               | Private source                                                           |
| -------------------- | ------------------------------------------------------------------------ |
| CLASP_AUTH_JSON      | The clasp authorization JSON for a dedicated deployment identity/profile |
| CLASP_PROJECT_JSON   | Your local .clasp.json                                                   |
| DAYOFF_DEPLOYMENT_ID | deploymentId from local/deployment.json                                  |
| DAYOFF_CONFIG_JSON   | Your local/config.json                                                   |
| DAYOFF_SEED_JSON     | Your local/legacy.json, if a workbook was imported                       |
| DAYOFF_HISTORY_JSON  | Optional local/attendance-history.json, for a multi-year archive         |

Keep the imported policy snapshot in subsequent deployments so opening amounts do not change. Empty seed is appropriate only for an installation that never imported a workbook.

Use gh secret set with stdin from a private file; never place credentials in command-line arguments or issue/PR text. For example:

```sh
gh api --method PUT repos/OWNER/REPO/environments/dayoff
gh secret set DAYOFF_CONFIG_JSON --repo OWNER/REPO --env dayoff < local/config.json
gh secret set DAYOFF_SEED_JSON --repo OWNER/REPO --env dayoff < local/legacy.json
gh secret set CLASP_PROJECT_JSON --repo OWNER/REPO --env dayoff < .clasp.json
# Add CLASP_AUTH_JSON and DAYOFF_DEPLOYMENT_ID from their private sources.
gh variable set DAYOFF_GITOPS_ENABLED --body true --repo OWNER/REPO
```

The workflow runs containerized checks with generic configuration before restoring private material. It then deploys changes on main or permits a manual deploy/teardown. Manual dispatch defaults to dry run. A single concurrency group serializes deployments. Private files are removed after the job, and bundles are never uploaded as artifacts.

## Reconfigure an existing GitOps installation

Apply calendar and recipient changes locally using `node scripts/configure.ts --calendar-id 'YOUR_STAFF_CALENDAR_ID'` and/or `--management-email 'manager@example.edu'`. Both support `--dry-run`; other settings remain in the private JSON. Update the encrypted configuration secret before the next workflow deployment:

```sh
gh secret set DAYOFF_CONFIG_JSON --repo OWNER/REPO --env dayoff < local/config.json
```

If you use the optional archive, set `DAYOFF_HISTORY_JSON` from its private JSON file with `gh secret set DAYOFF_HISTORY_JSON --repo OWNER/REPO --env dayoff < local/attendance-history.json`. GitHub limits individual secrets to 48 KB. For a larger archive, the same secret accepts a `gzip:` prefix followed by base64-encoded gzip JSON. Prepare a private compressed file and upload it through stdin:

```sh
.venv/bin/python - <<'PYTHON'
import base64, gzip
from pathlib import Path
source = Path('local/attendance-history.json').read_bytes()
target = Path('local/attendance-history.secret')
target.write_text('gzip:' + base64.b64encode(gzip.compress(source, mtime=0)).decode())
target.chmod(0o600)
assert target.stat().st_size < 48 * 1024, 'Archive needs a private secret store with a larger size limit.'
print('Private archive secret prepared; contents omitted.')
PYTHON
gh secret set DAYOFF_HISTORY_JSON --repo OWNER/REPO --env dayoff < local/attendance-history.secret
```

No archive data belongs in the public repository or workflow output. After deployment, the owner imports pending revisions in the app; redeployment does not mutate the ledger. Existing archived years remain readable if this optional secret is absent.

Keep `DAYOFF_SEED_JSON` synchronized if an explicitly reviewed import migration changes it. Updating a GitHub secret does not itself deploy; dispatch the deployment workflow or let an enabled main-branch deployment apply it. A local CLI deployment alone does not update the GitHub secret, so an old secret would restore old settings on the next GitOps deployment.

If you prefer workstation-only deployments, leave the variable unset. Source CI still runs. Google OAuth consent or administrator policy changes may require interaction on the trusted workstation before unattended updates can resume.

This repository's workflow supports one personal installation. Coworkers should fork/use their own repository and secrets rather than sharing your credentials or private configuration.

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

If you prefer workstation-only deployments, leave the variable unset. Source CI still runs. Google OAuth consent or administrator policy changes may require interaction on the trusted workstation before unattended updates can resume.

This repository's workflow supports one personal installation. Coworkers should fork/use their own repository and secrets rather than sharing your credentials or private configuration.

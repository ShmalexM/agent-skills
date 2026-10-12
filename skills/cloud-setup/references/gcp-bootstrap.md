# New Google Cloud project bootstrap

Replace the placeholders, show the user the filled-in list, and get a yes before step 1. Steps 2 and 7 need their own yes. Every command passes `--project` explicitly.

| Placeholder | Meaning |
|---|---|
| `PROJECT` | New project ID (6–30 characters, lowercase, globally unique) |
| `PARENT` | `--folder=FOLDER_ID` or `--organization=ORG_ID` (none for a personal account without an org) |
| `BILLING` | Billing account ID (`gcloud billing accounts list`) |
| `REGION` | Default region, for example `us-central1` |
| `OWNER/REPO` | GitHub repository that will deploy |

## 1. Create the project

```bash
gcloud projects create PROJECT PARENT --labels=env=dev,owner=TEAM_OR_USER
gcloud projects describe PROJECT --format='value(projectNumber)'   # note PROJECT_NUMBER
```

## 2. Link billing (separate yes; this starts charges)

```bash
gcloud billing projects link PROJECT --billing-account=BILLING
```

## 3. Budget with alerts

```bash
gcloud billing budgets create --billing-account=BILLING \
  --display-name="PROJECT monthly" --budget-amount=AMOUNT_USD \
  --filter-projects=projects/PROJECT_NUMBER \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

Budgets alert; they do not stop spending. Say so.

## 4. Enable only the APIs needed

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com --project=PROJECT
```

Adjust the list to the workload. `iamcredentials` and `sts` are needed for step 6.

## 5. Deploy service account with narrow roles

```bash
gcloud iam service-accounts create deployer --display-name="CI deployer" --project=PROJECT
# Example for Cloud Run from Artifact Registry; grant only what the deploy needs.
gcloud projects add-iam-policy-binding PROJECT --member=serviceAccount:deployer@PROJECT.iam.gserviceaccount.com --role=roles/run.admin
gcloud projects add-iam-policy-binding PROJECT --member=serviceAccount:deployer@PROJECT.iam.gserviceaccount.com --role=roles/artifactregistry.writer
gcloud iam service-accounts add-iam-policy-binding RUNTIME_SA@PROJECT.iam.gserviceaccount.com \
  --member=serviceAccount:deployer@PROJECT.iam.gserviceaccount.com --role=roles/iam.serviceAccountUser --project=PROJECT
```

Do not create keys for this account.

## 6. Keyless GitHub Actions access (workload identity federation)

```bash
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions" --project=PROJECT
gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='OWNER/REPO'" --project=PROJECT
gcloud iam service-accounts add-iam-policy-binding deployer@PROJECT.iam.gserviceaccount.com --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/OWNER/REPO" \
  --project=PROJECT
```

The attribute condition limits the pool to one repository. To limit it further to the default branch, add `&& assertion.ref=='refs/heads/main'`.

On the GitHub side (with the `github-setup` skill), store these as repository **variables**; they are not secrets:

```bash
gh variable set GCP_WIF_PROVIDER --repo OWNER/REPO --body "projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github"
gh variable set GCP_DEPLOY_SA --repo OWNER/REPO --body "deployer@PROJECT.iam.gserviceaccount.com"
```

The workflow needs `permissions: id-token: write` and the `google-github-actions/auth` action, pinned to a commit SHA, with `workload_identity_provider` and `service_account` taken from those variables.

## 7. Organization policies (separate yes; needs an org policy admin)

Recommended where the project sits in an organization:

- `iam.disableServiceAccountKeyCreation`: no service-account keys;
- `storage.publicAccessPrevention`: no public buckets;
- `storage.uniformBucketLevelAccess`: no per-object ACLs;
- `compute.requireOsLogin` and `compute.vmExternalIpAccess`: for projects with VMs.

## 8. Verify

```bash
node <this skill's folder>/scripts/audit-gcp.mjs PROJECT
```

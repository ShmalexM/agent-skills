# AWS and Azure: read-only audit commands

Run these, read the JSON, and fill the same checklist as the Google Cloud audit. All commands only read. Add `--profile NAME` (AWS) or `--subscription ID` (Azure) instead of changing the user's defaults.

## AWS account

| Check | Command | Fails when |
|---|---|---|
| Identity | `aws sts get-caller-identity` | not the account the user named |
| Root MFA | `aws iam get-account-summary --query 'SummaryMap.AccountMFAEnabled'` | `0` |
| Root access keys | `aws iam get-account-summary --query 'SummaryMap.AccountAccessKeysPresent'` | `1` |
| IAM users with long-lived keys | `aws iam list-users`, then `aws iam list-access-keys --user-name USER` | active keys, especially older than 90 days |
| Admin policies | `aws iam list-entities-for-policy --policy-arn arn:aws:iam::aws:policy/AdministratorAccess` | users or roles that do not need it |
| Budgets | `aws budgets describe-budgets --account-id ACCOUNT` | no budget with notifications |
| CloudTrail | `aws cloudtrail describe-trails` and `aws cloudtrail get-trail-status --name TRAIL` | no multi-region trail that is logging |
| S3 public access block | `aws s3control get-public-access-block --account-id ACCOUNT` | any setting `false` or no configuration |
| Open admin ports | `aws ec2 describe-security-groups --filters Name=ip-permission.cidr,Values=0.0.0.0/0 --query 'SecurityGroups[].{id:GroupId,perms:IpPermissions}'` | port 22, 3389 or all traffic open to `0.0.0.0/0` |
| GuardDuty | `aws guardduty list-detectors` | empty in a region you use |
| GitHub OIDC | `aws iam list-open-id-connect-providers`, then the deploy role's trust policy (`aws iam get-role --role-name ROLE`) | long-lived keys used for CI, or a trust policy without a `token.actions.githubusercontent.com:sub` condition for one repository |

Regional services (security groups, GuardDuty) need a check per region in use: `aws ec2 describe-regions --query 'Regions[].RegionName'`.

## Azure subscription

| Check | Command | Fails when |
|---|---|---|
| Identity | `az account show` | not the subscription the user named |
| Owners | `az role assignment list --role Owner --scope /subscriptions/SUB --include-inherited` | more owners than needed, or guest accounts |
| Budgets | `az consumption budget list --subscription SUB` | no budget |
| Defender for Cloud | `az security pricing list --subscription SUB` | plans you rely on are on the Free tier |
| Activity log export | `az monitor diagnostic-settings subscription list --subscription SUB` | no export to a workspace or storage |
| Public storage | `az storage account list --subscription SUB --query "[].{name:name,publicBlob:allowBlobPublicAccess,tls:minimumTlsVersion}"` | `publicBlob: true`, or TLS below 1.2 |
| Open admin ports | `az network nsg list --subscription SUB --query "[].{nsg:name,rules:securityRules[?access=='Allow' && direction=='Inbound']}"` | 22, 3389 or `*` allowed from `*` or `Internet` |
| Keyless GitHub access | `az identity federated-credential list --identity-name ID --resource-group RG` (managed identity) or `az ad app federated-credential list --id APP_ID` | CI uses a client secret instead of a federated credential for one repository |

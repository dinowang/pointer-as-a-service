# GitHub Setup Guide

本文件說明 GitHub Actions 工作流程所需的設定，包含 Secrets、Permissions 和 Azure OIDC Federated Credential 的建立。

## 必要的 Repository Secrets

在 **Settings → Secrets and variables → Actions → Repository secrets** 中新增以下項目：

| Secret 名稱 | 說明 | 來源 |
|---|---|---|
| `AZURE_CLIENT_ID` | App Registration 的 Application (client) ID | 見下方「建立 App Registration」 |
| `AZURE_TENANT_ID` | Azure AD Tenant ID | Azure Portal → Microsoft Entra ID → Overview |
| `AZURE_SUBSCRIPTION_ID` | Azure 訂閱 ID (GUID) | Azure Portal → Subscriptions |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Static Web Apps 部署 Token | 首次執行 `provision-infrastructure` 後，從 Terraform output 取得 |
| `TFSTATE_ENCRYPTION_KEY` | Terraform state 加密金鑰（AES-256-CBC） | 自行產生，見下方說明 |

> 💡 本專案使用 **OIDC Federated Credential** 認證，不需要 client secret。GitHub Actions 透過 OIDC token 直接與 Azure AD 交換 access token，無密碼洩漏風險且無需輪替。

## 建立 App Registration + Federated Credential

### 自動化腳本（推薦）

一鍵完成 App Registration、Service Principal、Federated Credential 建立，以及 GitHub Secrets 設定：

```bash
# 自動偵測 tenant 和 subscription（適用單一租戶）
./scripts/setup-azure-oidc.sh

# 指定 tenant（適用多租戶環境）
./scripts/setup-azure-oidc.sh --tenant-id <YOUR_TENANT_ID>

# 同時指定 tenant 和 subscription
./scripts/setup-azure-oidc.sh --tenant-id <YOUR_TENANT_ID> --subscription-id <YOUR_SUBSCRIPTION_ID>

# 查看完整用法
./scripts/setup-azure-oidc.sh --help
```

> 前置條件：`az login` + `gh auth login` 已完成

| 參數 | 說明 | 預設值 |
|---|---|---|
| `--tenant-id` | Azure AD Tenant ID | 從 `az account show` 自動取得 |
| `--subscription-id` | Azure Subscription ID | 從 `az account show` 自動取得 |

腳本會自動：
1. 建立 App Registration + Service Principal
2. 授予 Contributor 角色
3. 建立兩條 Federated Credential（main branch + production environment）
4. 產生 Terraform state 加密金鑰
5. 透過 `gh secret set` 設定所有 GitHub Secrets
6. 每個步驟都支援冪等（重複執行會跳過已存在的資源）

### 手動建立（替代方式）

<details>
<summary>展開手動步驟</summary>

#### Step 1：建立 App Registration

```bash
az ad app create --display-name "github-pointer-as-a-service"
# 記下輸出的 appId（即 AZURE_CLIENT_ID）
```

#### Step 2：建立 Service Principal 並授權

```bash
az ad sp create --id <APP_ID>

az role assignment create \
  --assignee <APP_ID> \
  --role Contributor \
  --scope /subscriptions/<YOUR_SUBSCRIPTION_ID>
```

#### Step 3：建立 Federated Credential

```bash
APP_OBJECT_ID=$(az ad app show --id <APP_ID> --query id -o tsv)

# main 分支的 push 觸發
az ad app federated-credential create \
  --id $APP_OBJECT_ID \
  --parameters '{
    "name": "github-main-branch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<YOUR_GITHUB_USER>/pointer-as-a-service:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'

# 手動觸發 (workflow_dispatch)
az ad app federated-credential create \
  --id $APP_OBJECT_ID \
  --parameters '{
    "name": "github-workflow-dispatch",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<YOUR_GITHUB_USER>/pointer-as-a-service:environment:production",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

#### 透過 Azure Portal 建立

1. Azure Portal → **Microsoft Entra ID** → **App registrations** → 選擇你的 App
2. 左側 **Certificates & secrets** → **Federated credentials** → **Add credential**
3. 選擇 **GitHub Actions deploying Azure resources**
4. 填入：
   - Organization: `<your GitHub username or org>`
   - Repository: `pointer-as-a-service`
   - Entity type: `Branch` → `main`
5. 重複上述步驟，新增 Entity type: `Environment` → `production`

</details>

## 取得 Static Web Apps API Token

`AZURE_STATIC_WEB_APPS_API_TOKEN` 需要在 Azure 資源建立後才能取得。

### 方法 1：從 Terraform Output 取得

```bash
cd src/terraform
terraform output -raw static_webapp_api_token
```

### 方法 2：從 Azure Portal 取得

1. 前往 Azure Portal → 搜尋你的 Static Web App 資源（預設名稱 `pointer-swa`）
2. 左側選單 → **Overview** → **Manage deployment token**
3. 複製 Token 值

### 設定順序

由於 `AZURE_STATIC_WEB_APPS_API_TOKEN` 依賴 Terraform 建立的資源，建議按以下順序操作：

1. 先設定 `AZURE_CLIENT_ID`、`AZURE_TENANT_ID` 和 `AZURE_SUBSCRIPTION_ID`
2. 手動觸發 **Provision Infrastructure** workflow（或本地執行 `terraform apply`）
3. 從 Terraform output 取得 SWA API Token
4. 設定 `AZURE_STATIC_WEB_APPS_API_TOKEN`
5. 手動觸發 **Deploy Web App** workflow

## GitHub Actions Permissions

在 **Settings → Actions → General → Workflow permissions** 中確認：

- ✅ **Read and write permissions** — 允許 workflows 上傳 artifacts
- ✅ **Allow GitHub Actions to create and approve pull requests**（選配）

## Workflows 概覽

### Provision Infrastructure (`provision-infrastructure.yml`)

| 項目 | 說明 |
|---|---|
| **觸發** | `push` to `main` (paths: `src/terraform/**`, `src/functions/**`) 或手動 |
| **用途** | Terraform apply 建立 Azure 資源 + 部署 Azure Functions |
| **Secrets 使用** | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` |
| **認證方式** | OIDC Federated Credential（無 client secret） |
| **Artifacts** | 無（state 儲存於 `terraform-state` 分支） |

### Deploy Web App (`deploy-webapp.yml`)

| 項目 | 說明 |
|---|---|
| **觸發** | `push` to `main` (paths: `src/static-webapp/**`, `manifest/**`) 或手動 |
| **用途** | 產生 Office Add-in manifest + 部署靜態網站到 Azure Static Web Apps |
| **Secrets 使用** | `AZURE_STATIC_WEB_APPS_API_TOKEN` |
| **認證方式** | SWA API Token（不需要 Azure Login） |
| **Artifacts** | 上傳 `office-addin-manifest`（manifest.xml，可下載安裝 Add-in） |
| **手動輸入** | `base_url`（選填，預設使用 Terraform 中設定的 SWA URL） |

## Terraform State 儲存方式

本專案將 Terraform state **加密後**儲存在 **`terraform-state` 分支**（orphan branch），使用 AES-256-CBC 加密，即使 repo 為 public 也不會洩漏敏感資訊。

### 運作機制

1. **Restore** — 從 `terraform-state` 分支取出 `terraform.tfstate.enc`，用 `TFSTATE_ENCRYPTION_KEY` 解密
2. **Terraform Apply** — 正常執行，產生/更新 `terraform.tfstate`
3. **Save** — 將 state 加密為 `terraform.tfstate.enc`，commit 到 `terraform-state` 分支

### 產生加密金鑰

```bash
# 產生隨機 32 bytes base64 編碼金鑰
openssl rand -base64 32
```

將輸出值設定為 GitHub Secret `TFSTATE_ENCRYPTION_KEY`。

> ⚠️ **金鑰遺失將無法恢復 state**，請妥善備份。

### 優點

- **安全** — state 以 AES-256-CBC 加密，branch 中不含明文 secrets
- **不會過期** — 不受 GitHub Actions artifact 90 天保留限制
- **版本歷史** — 每次 state 變更都有 git commit 記錄，可追溯
- **適用 public repo** — 加密內容即使被讀取也無法解密

### 手動檢視 State

```bash
git fetch origin terraform-state
git show origin/terraform-state:terraform.tfstate.enc > terraform.tfstate.enc
openssl enc -aes-256-cbc -d -pbkdf2 -salt \
  -in terraform.tfstate.enc \
  -out terraform.tfstate \
  -pass pass:"YOUR_ENCRYPTION_KEY"
cat terraform.tfstate | jq .
```

## 快速開始 Checklist

- [ ] 登入 Azure CLI（`az login`）和 GitHub CLI（`gh auth login`）
- [ ] 執行 `./scripts/setup-azure-oidc.sh`
- [ ] 確認 Actions Permissions 為 Read and write
- [ ] 手動觸發 **Provision Infrastructure** workflow
- [ ] 從 Terraform output 取得 SWA API Token
- [ ] 設定 secret: `AZURE_STATIC_WEB_APPS_API_TOKEN`（`gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN`）
- [ ] 手動觸發 **Deploy Web App** workflow
- [ ] 驗證網站可正常存取

#!/usr/bin/env bash
set -euo pipefail

#
# 建立 Azure App Registration + Service Principal + OIDC Federated Credential
# 並自動設定 GitHub Repository Secrets
#
# 前置條件:
#   - Azure CLI (az) 已登入
#   - GitHub CLI (gh) 已登入
#   - 在 repository 根目錄執行
#
# 用法:
#   ./scripts/setup-azure-oidc.sh [--tenant-id <TENANT_ID>] [--subscription-id <SUBSCRIPTION_ID>]
#

# ── 解析參數 ────────────────────────────────────────────────
ARG_TENANT_ID=""
ARG_SUBSCRIPTION_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --tenant-id)        ARG_TENANT_ID="$2"; shift 2 ;;
    --subscription-id)  ARG_SUBSCRIPTION_ID="$2"; shift 2 ;;
    -h|--help)
      echo "用法: $0 [--tenant-id <TENANT_ID>] [--subscription-id <SUBSCRIPTION_ID>]"
      echo ""
      echo "  --tenant-id         指定 Azure AD Tenant ID（多租戶環境時使用）"
      echo "  --subscription-id   指定 Azure Subscription ID"
      echo ""
      echo "若未指定，將自動從目前 az login 的帳號取得。"
      exit 0
      ;;
    *) echo "❌ 未知參數: $1（使用 --help 查看用法）" >&2; exit 1 ;;
  esac
done

# ── 設定值（自動偵測）──────────────────────────────────────
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || git remote get-url origin | sed -E 's|.*github\.com[:/]||;s|\.git$||')
REPO_NAME=$(echo "$REPO" | cut -d'/' -f2)
APP_DISPLAY_NAME="github-${REPO_NAME}"
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}' || echo "main")

# ── 檢查前置工具 ────────────────────────────────────────────
for cmd in az gh jq openssl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "❌ 需要 $cmd，請先安裝" >&2
    exit 1
  fi
done

echo "🔍 檢查 Azure CLI 登入狀態..."
az account show --output none 2>/dev/null || { echo "❌ 請先執行 az login" >&2; exit 1; }

echo "🔍 檢查 GitHub CLI 登入狀態..."
gh auth status &>/dev/null || { echo "❌ 請先執行 gh auth login" >&2; exit 1; }

# ── 取得基本資訊 ────────────────────────────────────────────
SUBSCRIPTION_ID="${ARG_SUBSCRIPTION_ID:-$(az account show --query id -o tsv)}"
TENANT_ID="${ARG_TENANT_ID:-$(az account show --query tenantId -o tsv)}"
echo "📋 Subscription: $SUBSCRIPTION_ID"
echo "📋 Tenant:       $TENANT_ID"

# ── Step 1: 建立 App Registration ───────────────────────────
echo ""
echo "🔧 Step 1: 建立 App Registration..."
APP_ID=$(az ad app list --display-name "$APP_DISPLAY_NAME" --query '[0].appId' -o tsv 2>/dev/null)
if [ -n "$APP_ID" ] && [ "$APP_ID" != "None" ]; then
  echo "   ⏭️  已存在: $APP_DISPLAY_NAME (appId: $APP_ID)"
else
  APP_ID=$(az ad app create --display-name "$APP_DISPLAY_NAME" --query appId -o tsv)
  echo "   ✅ 已建立: $APP_DISPLAY_NAME (appId: $APP_ID)"
fi

# ── Step 2: 建立 Service Principal ──────────────────────────
echo ""
echo "🔧 Step 2: 建立 Service Principal..."
SP_EXISTS=$(az ad sp show --id "$APP_ID" --query appId -o tsv 2>/dev/null || echo "")
if [ -n "$SP_EXISTS" ]; then
  echo "   ⏭️  已存在"
else
  az ad sp create --id "$APP_ID" --output none
  echo "   ✅ 已建立"
fi

# ── Step 3: 授予 Contributor 角色 ───────────────────────────
echo ""
echo "🔧 Step 3: 授予 Contributor 角色..."
ROLE_EXISTS=$(az role assignment list --assignee "$APP_ID" --role Contributor --scope "/subscriptions/$SUBSCRIPTION_ID" --query '[0].id' -o tsv 2>/dev/null || echo "")
if [ -n "$ROLE_EXISTS" ]; then
  echo "   ⏭️  已存在"
else
  az role assignment create \
    --assignee "$APP_ID" \
    --role Contributor \
    --scope "/subscriptions/$SUBSCRIPTION_ID" \
    --output none
  echo "   ✅ 已授予"
fi

# ── Step 4: 建立 Federated Credentials ─────────────────────
APP_OBJECT_ID=$(az ad app show --id "$APP_ID" --query id -o tsv)

create_federated_credential() {
  local name="$1"
  local subject="$2"

  EXISTING=$(az ad app federated-credential list --id "$APP_OBJECT_ID" --query "[?name=='$name'].name" -o tsv 2>/dev/null || echo "")
  if [ -n "$EXISTING" ]; then
    echo "   ⏭️  已存在: $name"
  else
    az ad app federated-credential create \
      --id "$APP_OBJECT_ID" \
      --parameters "{
        \"name\": \"$name\",
        \"issuer\": \"https://token.actions.githubusercontent.com\",
        \"subject\": \"$subject\",
        \"audiences\": [\"api://AzureADTokenExchange\"]
      }" --output none
    echo "   ✅ 已建立: $name"
  fi
}

echo ""
echo "🔧 Step 4: 建立 Federated Credentials..."
create_federated_credential "github-${DEFAULT_BRANCH}-branch" "repo:${REPO}:ref:refs/heads/${DEFAULT_BRANCH}"
create_federated_credential "github-workflow-dispatch" "repo:${REPO}:environment:production"

# ── Step 5: 產生 Terraform State 加密金鑰 ──────────────────
echo ""
echo "🔧 Step 5: 產生 Terraform State 加密金鑰..."
TFSTATE_KEY=$(openssl rand -base64 32)
echo "   ✅ 已產生"

# ── Step 6: 設定 GitHub Secrets ─────────────────────────────
echo ""
echo "🔧 Step 6: 設定 GitHub Repository Secrets..."

set_secret() {
  local name="$1"
  local value="$2"
  if gh secret set "$name" --repo "$REPO" --body "$value" 2>/dev/null; then
    echo "   ✅ $name"
    return 0
  else
    return 1
  fi
}

SECRETS_OK=true
set_secret AZURE_CLIENT_ID        "$APP_ID"           || SECRETS_OK=false
set_secret AZURE_TENANT_ID        "$TENANT_ID"         || SECRETS_OK=false
set_secret AZURE_SUBSCRIPTION_ID  "$SUBSCRIPTION_ID"   || SECRETS_OK=false
set_secret TFSTATE_ENCRYPTION_KEY "$TFSTATE_KEY"       || SECRETS_OK=false

if [ "$SECRETS_OK" = false ]; then
  echo ""
  echo "⚠️  無法透過 gh CLI 設定 Secrets（token 可能缺少 repo scope）"
  echo ""
  echo "   修復方式 1: 重新登入並授權 repo scope"
  echo "     gh auth login -s repo"
  echo ""
  echo "   修復方式 2: 手動在 GitHub 網頁設定"
  echo "     https://github.com/${REPO}/settings/secrets/actions"
  echo ""
  echo "   需要設定的值："
  echo "     AZURE_CLIENT_ID        = $APP_ID"
  echo "     AZURE_TENANT_ID        = $TENANT_ID"
  echo "     AZURE_SUBSCRIPTION_ID  = $SUBSCRIPTION_ID"
  echo "     TFSTATE_ENCRYPTION_KEY = (請見下方)"
  echo ""
  echo "   修復方式 3: 授權後重新執行此腳本中的 secret 設定"
  echo "     gh secret set AZURE_CLIENT_ID        --repo $REPO --body \"$APP_ID\""
  echo "     gh secret set AZURE_TENANT_ID        --repo $REPO --body \"$TENANT_ID\""
  echo "     gh secret set AZURE_SUBSCRIPTION_ID  --repo $REPO --body \"$SUBSCRIPTION_ID\""
  echo "     gh secret set TFSTATE_ENCRYPTION_KEY --repo $REPO"
fi

# ── 完成 ────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════"
if [ "$SECRETS_OK" = true ]; then
  echo "✅ 設定完成！"
else
  echo "⚠️  Azure 資源已建立，但 GitHub Secrets 需手動設定（見上方說明）"
fi
echo ""
echo "📋 摘要:"
echo "   App Registration:  $APP_DISPLAY_NAME"
echo "   Client ID:         $APP_ID"
echo "   Tenant ID:         $TENANT_ID"
echo "   Subscription ID:   $SUBSCRIPTION_ID"
echo ""
echo "⚠️  TFSTATE_ENCRYPTION_KEY 請妥善備份，遺失將無法恢復 Terraform state。"
echo ""
echo "📌 剩餘步驟:"
echo "   1. 手動觸發 Provision Infrastructure workflow"
echo "   2. 從 Terraform output 取得 SWA API Token"
echo "   3. 執行: gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo $REPO"
echo "   4. 手動觸發 Deploy Web App workflow"
echo "══════════════════════════════════════════════════════════"

resource "azurerm_storage_account" "functions" {
  name                     = "st${replace(var.prefix, "-", "")}"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  tags = var.tags
}

resource "azurerm_service_plan" "functions" {
  name                = "asp-${var.prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "Y1"

  tags = var.tags
}

resource "azurerm_linux_function_app" "main" {
  name                       = "func-${var.prefix}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  service_plan_id            = azurerm_service_plan.functions.id
  storage_account_name       = azurerm_storage_account.functions.name
  storage_account_access_key = azurerm_storage_account.functions.primary_access_key

  site_config {
    application_stack {
      node_version = "20"
    }

    cors {
      allowed_origins = [
        "https://${azurerm_static_web_app.main.default_host_name}"
      ]
    }
  }

  app_settings = {
    "WEB_PUBSUB_CONNECTION_STRING" = azurerm_web_pubsub.main.primary_connection_string
    "WEB_PUBSUB_HUB_NAME"         = "pointer"
  }

  tags = var.tags
}

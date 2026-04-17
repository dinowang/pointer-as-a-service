resource "azurerm_static_web_app" "main" {
  name                = "swa-${var.prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku_tier            = "Free"
  sku_size            = "Free"

  tags = var.tags
}

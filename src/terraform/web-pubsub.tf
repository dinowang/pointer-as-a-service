resource "azurerm_web_pubsub" "main" {
  name                = "${var.prefix}-wps"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Free_F1"
  capacity            = 1

  tags = var.tags
}

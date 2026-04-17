output "resource_group_name" {
  description = "Name of the resource group"
  value       = azurerm_resource_group.main.name
}

output "static_webapp_url" {
  description = "Default URL of the Static Web App"
  value       = "https://${azurerm_static_web_app.main.default_host_name}"
}

output "static_webapp_api_token" {
  description = "API token for deploying to Static Web Apps"
  value       = azurerm_static_web_app.main.api_key
  sensitive   = true
}

output "function_app_name" {
  description = "Name of the Function App for deployment"
  value       = azurerm_linux_function_app.main.name
}

output "function_app_url" {
  description = "Default URL of the Function App"
  value       = "https://${azurerm_linux_function_app.main.default_hostname}"
}

output "web_pubsub_connection_string" {
  description = "Connection string for Azure Web PubSub"
  value       = azurerm_web_pubsub.main.primary_connection_string
  sensitive   = true
}

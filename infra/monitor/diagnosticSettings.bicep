targetScope = 'resourceGroup'

// TODO: Wire diagnostics for each service resource to LAW.
resource note 'Microsoft.Resources/deployments@2021-04-01' = {
  name: 'diagnostic-settings-stub'
  properties: {
    mode: 'Incremental'
    template: {
      '$schema': 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#'
      contentVersion: '1.0.0.0'
      resources: []
    }
  }
}

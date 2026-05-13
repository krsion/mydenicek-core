targetScope = 'resourceGroup'

@description('Name of the Web App.')
param name string

@description('Azure region.')
param location string

@description('Resource ID of the App Service Plan.')
param planId string

@description('Resource ID of the subnet for VNet integration.')
param subnetId string

@description('Application Insights connection string.')
param appInsightsConnStr string

@description('Whether to enable authentication in the app.')
param authEnabled bool = true

@description('Resource tags.')
param tags object = {}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: planId
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'AUTH_ENABLED'
          value: string(authEnabled)
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnStr
        }
      ]
    }
    virtualNetworkSubnetId: subnetId
    vnetRouteAllEnabled: true
  }
}

// Staging deployment slot
resource stagingSlot 'Microsoft.Web/sites/slots@2023-12-01' = {
  parent: webApp
  name: 'staging'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: planId
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'AUTH_ENABLED'
          value: string(authEnabled)
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnStr
        }
      ]
    }
    virtualNetworkSubnetId: subnetId
    vnetRouteAllEnabled: true
  }
}

output webAppId string = webApp.id
output webAppName string = webApp.name
output defaultHostName string = webApp.properties.defaultHostName
output principalId string = webApp.identity.principalId

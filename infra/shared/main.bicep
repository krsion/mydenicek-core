targetScope = 'subscription'

@description('Deployment location for shared resources.')
param location string = deployment().location

@description('Prefix used for resource naming.')
param prefix string = 'mydenicek'

@description('Resource group name for shared resources.')
param sharedRgName string = '${prefix}-shared-rg'

@description('Budget notification emails.')
param budgetContactEmails array = []
@description('Budget period start date (ISO UTC).')
param budgetStartDate string = '2026-01-01T00:00:00Z'

resource sharedRg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: sharedRgName
  location: location
  tags: {
    app: 'mydenicek'
    env: 'shared'
  }
}

module managementGroups './managementGroups.bicep' = {
  name: 'management-groups'
  scope: tenant()
}

module policy './policy.bicep' = {
  name: 'policy'
  scope: subscription()
}

module customRole './customRole.bicep' = {
  name: 'custom-role'
  scope: subscription()
}

module law './logAnalytics.bicep' = {
  name: 'log-analytics'
  scope: resourceGroup(sharedRg.name)
  params: {
    location: location
    workspaceName: '${prefix}-law'
  }
}

module appInsights './appInsights.bicep' = {
  name: 'app-insights'
  scope: resourceGroup(sharedRg.name)
  params: {
    location: location
    appInsightsName: '${prefix}-appi'
    logAnalyticsWorkspaceResourceId: law.outputs.workspaceId
  }
}

module acr './acr.bicep' = {
  name: 'acr'
  scope: resourceGroup(sharedRg.name)
  params: {
    location: location
    acrName: take(toLower(replace('${prefix}acr${uniqueString(subscription().id)}', '-', '')), 50)
  }
}

module entraApp './entraApp.bicep' = {
  name: 'entra-app'
  scope: resourceGroup(sharedRg.name)
  params: {
    appName: '${prefix}-web'
  }
}

module dnsZone './dnsZone.bicep' = {
  name: 'dns-zone'
  scope: resourceGroup(sharedRg.name)
  params: {
    zoneName: 'privatelink.blob.core.windows.net'
  }
}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: '${prefix}-monthly-budget'
  properties: {
    category: 'Cost'
    amount: 50
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
      endDate: '2099-12-31T00:00:00Z'
    }
    notifications: {
      eightyPercent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: budgetContactEmails
      }
    }
  }
}

output sharedResourceGroupName string = sharedRg.name
output logAnalyticsWorkspaceId string = law.outputs.workspaceId
output appInsightsId string = appInsights.outputs.appInsightsId
output acrId string = acr.outputs.acrId
output acrLoginServer string = acr.outputs.loginServer

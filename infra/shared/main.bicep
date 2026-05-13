targetScope = 'subscription'

@description('Environment name (dev or prod).')
@allowed(['dev', 'prod'])
param environment string

@description('Primary Azure region for all resources.')
param location string = 'westeurope'

@description('Email address for budget alert notifications.')
param budgetContactEmail string

var tags = {
  app: 'mydenicek'
  environment: environment
}

var rgName = 'rg-mydenicek-shared-${environment}'

// ── Management groups ────────────────────────────────────────────────────────
// Management groups are tenant-scoped; deploy separately via managementGroups.bicep
// TODO: deploy managementGroups.bicep at tenant scope via a pipeline step

// ── Policy (subscription-scoped) ─────────────────────────────────────────────
module policy 'policy.bicep' = {
  name: 'policy-${environment}'
  params: {
    environment: environment
  }
}

// ── Custom RBAC role (subscription-scoped) ────────────────────────────────────
module customRole 'customRole.bicep' = {
  name: 'customRole-${environment}'
  params: {
    environment: environment
  }
}

// ── Shared resource group ─────────────────────────────────────────────────────
resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: rgName
  location: location
  tags: tags
}

// ── Log Analytics Workspace ───────────────────────────────────────────────────
module logAnalytics 'logAnalytics.bicep' = {
  name: 'logAnalytics-${environment}'
  scope: rg
  params: {
    name: 'law-mydenicek-${environment}'
    location: location
    tags: tags
  }
}

// ── Application Insights ──────────────────────────────────────────────────────
module appInsights 'appInsights.bicep' = {
  name: 'appInsights-${environment}'
  scope: rg
  params: {
    name: 'appi-mydenicek-${environment}'
    location: location
    workspaceResourceId: logAnalytics.outputs.workspaceId
    tags: tags
  }
}

// ── Azure Container Registry ──────────────────────────────────────────────────
module acr 'acr.bicep' = {
  name: 'acr-${environment}'
  scope: rg
  params: {
    name: 'crmydenicek${environment}'
    location: location
    tags: tags
  }
}

// ── Public DNS Zone ───────────────────────────────────────────────────────────
module dnsZone 'dnsZone.bicep' = {
  name: 'dnsZone-${environment}'
  scope: rg
  params: {
    // TODO: replace with your real domain name
    zoneName: 'mydenicek.example.com'
    location: 'global'
    tags: tags
  }
}

// ── Key Vault ─────────────────────────────────────────────────────────────────
// TODO: supply a real privateEndpointSubnetId and privateDnsZoneId from network stack outputs
module keyvault 'keyvault.bicep' = {
  name: 'keyvault-${environment}'
  scope: rg
  params: {
    name: 'kv-mydenicek-${environment}'
    location: location
    // TODO: replace with actual subnet resource ID from network deployment
    privateEndpointSubnetId: 'TODO_SUBNET_ID'
    // TODO: replace with actual private DNS zone resource ID from network deployment
    privateDnsZoneId: 'TODO_DNS_ZONE_ID'
    tags: tags
  }
}

// ── Cost Management Budget ────────────────────────────────────────────────────
resource budget 'Microsoft.Consumption/budgets@2021-10-01' = {
  name: 'budget-mydenicek-${environment}'
  properties: {
    category: 'Cost'
    amount: 50
    timeGrain: 'Monthly'
    timePeriod: {
      // Budget is open-ended; adjust startDate to the current billing period
      startDate: '2024-01-01'
    }
    filter: {
      tags: {
        name: 'app'
        operator: 'In'
        values: ['mydenicek']
      }
    }
    notifications: {
      actual80Percent: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        contactEmails: [budgetContactEmail]
        thresholdType: 'Actual'
      }
    }
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
output resourceGroupName string = rg.name
output logAnalyticsWorkspaceId string = logAnalytics.outputs.workspaceId
output appInsightsConnectionString string = appInsights.outputs.connectionString
output acrLoginServer string = acr.outputs.loginServer
output keyVaultUri string = keyvault.outputs.vaultUri

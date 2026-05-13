targetScope = 'resourceGroup'

@description('Name of the action group.')
param name string

@description('Email address to send alert notifications to.')
param emailAddress string

@description('Must be "global" for action groups.')
param location string = 'global'

@description('Resource tags.')
param tags object = {}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    groupShortName: substring(replace(name, '-', ''), 0, min(length(replace(name, '-', '')), 12))
    enabled: true
    emailReceivers: [
      {
        name: 'ops-email'
        emailAddress: emailAddress
        useCommonAlertSchema: true
      }
    ]
  }
}

output actionGroupId string = actionGroup.id

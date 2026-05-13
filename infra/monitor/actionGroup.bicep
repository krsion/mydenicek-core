targetScope = 'resourceGroup'

param location string
param actionGroupName string
param notificationEmail string = ''

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  properties: {
    enabled: true
    emailReceivers: empty(notificationEmail)
      ? []
      : [
          {
            name: 'ops-email'
            emailAddress: notificationEmail
            useCommonAlertSchema: true
          }
        ]
  }
}

output actionGroupId string = actionGroup.id

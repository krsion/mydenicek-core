targetScope = 'resourceGroup'

@description('Name of the NSG.')
param name string

@description('Azure region for the NSG.')
param location string

@description('Resource ID of the Application Security Group used for workload NICs.')
param asgId string

@description('Resource tags.')
param tags object = {}

resource nsg 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'Allow-HTTPS-Inbound'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationApplicationSecurityGroups: [{ id: asgId }]
          destinationPortRange: '443'
          description: 'Allow HTTPS from the Internet to workload nodes.'
        }
      }
      {
        name: 'Allow-WebSocket-Inbound'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationApplicationSecurityGroups: [{ id: asgId }]
          destinationPortRange: '8787'
          description: 'Allow WebSocket traffic (port 8787) from the Internet to workload nodes.'
        }
      }
      {
        name: 'Allow-SSH-From-Mgmt'
        properties: {
          priority: 200
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          // Only the hub mgmt subnet (10.0.2.0/24) may SSH in
          sourceAddressPrefix: '10.0.2.0/24'
          sourcePortRange: '*'
          destinationApplicationSecurityGroups: [{ id: asgId }]
          destinationPortRange: '22'
          description: 'Allow SSH from the hub management subnet only.'
        }
      }
      {
        name: 'Allow-AzureLoadBalancer'
        properties: {
          priority: 900
          direction: 'Inbound'
          access: 'Allow'
          protocol: '*'
          sourceAddressPrefix: 'AzureLoadBalancer'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
          description: 'Required for Azure Load Balancer health probes.'
        }
      }
      {
        name: 'Deny-All-Inbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
          description: 'Deny all other inbound traffic.'
        }
      }
    ]
  }
}

output nsgId string = nsg.id
output nsgName string = nsg.name

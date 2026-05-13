targetScope = 'resourceGroup'

@description('Name of the load balancer.')
param name string

@description('Azure region.')
param location string

@description('Name of the public IP address resource.')
param publicIpName string

@description('Resource tags.')
param tags object = {}

resource publicIp 'Microsoft.Network/publicIPAddresses@2023-11-01' = {
  name: publicIpName
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Regional'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: {
      // TODO: replace with a real DNS label unique to your deployment
      domainNameLabel: replace(toLower(publicIpName), '_', '-')
    }
  }
}

resource lb 'Microsoft.Network/loadBalancers@2023-11-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Regional'
  }
  properties: {
    frontendIPConfigurations: [
      {
        name: 'frontend'
        properties: {
          publicIPAddress: {
            id: publicIp.id
          }
        }
      }
    ]
    backendAddressPools: [
      {
        name: 'backendPool'
      }
    ]
    probes: [
      {
        name: 'httpHealthz'
        properties: {
          protocol: 'Http'
          port: 8080
          requestPath: '/healthz'
          intervalInSeconds: 15
          numberOfProbes: 2
        }
      }
    ]
    loadBalancingRules: [
      {
        name: 'rule-443-to-8080'
        properties: {
          frontendIPConfiguration: {
            id: resourceId('Microsoft.Network/loadBalancers/frontendIPConfigurations', name, 'frontend')
          }
          backendAddressPool: {
            id: resourceId('Microsoft.Network/loadBalancers/backendAddressPools', name, 'backendPool')
          }
          probe: {
            id: resourceId('Microsoft.Network/loadBalancers/probes', name, 'httpHealthz')
          }
          protocol: 'Tcp'
          frontendPort: 443
          backendPort: 8080
          enableFloatingIP: false
          idleTimeoutInMinutes: 4
          loadDistribution: 'Default'
        }
      }
    ]
  }
}

output lbId string = lb.id
output lbName string = lb.name
output publicIpId string = publicIp.id
output publicIpAddress string = publicIp.properties.ipAddress
output backendPoolId string = lb.properties.backendAddressPools[0].id

targetScope = 'resourceGroup'

param location string
param lbName string
var lbId = resourceId('Microsoft.Network/loadBalancers', lbName)

resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${lbName}-pip'
  location: location
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
  tags: {
    app: 'mydenicek'
  }
}

resource lb 'Microsoft.Network/loadBalancers@2024-05-01' = {
  name: lbName
  location: location
  sku: {
    name: 'Standard'
  }
  tags: {
    app: 'mydenicek'
  }
  properties: {
    frontendIPConfigurations: [
      {
        name: 'public-frontend'
        properties: {
          publicIPAddress: {
            id: publicIp.id
          }
        }
      }
    ]
    backendAddressPools: [
      {
        name: 'backend-pool'
      }
    ]
    probes: [
      {
        name: 'tcp-probe'
        properties: {
          protocol: 'Tcp'
          port: 443
          intervalInSeconds: 15
          numberOfProbes: 2
        }
      }
    ]
    loadBalancingRules: [
      {
        name: 'https-rule'
        properties: {
          protocol: 'Tcp'
          frontendPort: 443
          backendPort: 443
          idleTimeoutInMinutes: 4
          enableFloatingIP: false
          frontendIPConfiguration: {
            id: '${lbId}/frontendIPConfigurations/public-frontend'
          }
          backendAddressPool: {
            id: '${lbId}/backendAddressPools/backend-pool'
          }
          probe: {
            id: '${lbId}/probes/tcp-probe'
          }
        }
      }
    ]
  }
}

output loadBalancerId string = lb.id

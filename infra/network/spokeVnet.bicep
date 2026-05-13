targetScope = 'resourceGroup'

@description('Name of the spoke VNet.')
param name string

@description('Azure region for the spoke VNet.')
param location string

@description('Address prefix for the spoke (e.g. 10.1.0.0/16). Subnets are carved from this block.')
param addressPrefix string

@description('Resource tags.')
param tags object = {}

// Derive the first three octets from the address prefix for subnet carving.
// Example: addressPrefix = '10.1.0.0/16' → base = '10.1'
var baseOctets = split(split(addressPrefix, '/')[0], '.')
var base = '${baseOctets[0]}.${baseOctets[1]}'

resource spokeVnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [addressPrefix]
    }
    subnets: [
      {
        // Primary workload subnet
        name: 'workload'
        properties: {
          addressPrefix: '${base}.0.0/24'
        }
      }
      {
        // Dedicated subnet for private endpoints (network policies disabled per Azure requirement)
        name: 'pe'
        properties: {
          addressPrefix: '${base}.1.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
      {
        // Subnet for internal load balancer front-ends
        name: 'lb'
        properties: {
          addressPrefix: '${base}.2.0/24'
        }
      }
    ]
  }
}

output vnetId string = spokeVnet.id
output vnetName string = spokeVnet.name
output workloadSubnetId string = spokeVnet.properties.subnets[0].id
output peSubnetId string = spokeVnet.properties.subnets[1].id
output lbSubnetId string = spokeVnet.properties.subnets[2].id

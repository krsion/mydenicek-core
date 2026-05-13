targetScope = 'resourceGroup'

@description('DNS zone name (e.g. mydenicek.example.com).')
param zoneName string

@description('Must be "global" for public DNS zones.')
param location string = 'global'

@description('Resource tags.')
param tags object = {}

// Public DNS zone — location must always be 'global'
resource dnsZone 'Microsoft.Network/dnsZones@2023-07-01-preview' = {
  name: zoneName
  location: location
  tags: tags
  properties: {
    zoneType: 'Public'
  }
}

output zoneId string = dnsZone.id
output zoneName string = dnsZone.name
// Authoritative name servers to configure at your domain registrar
output nameServers array = dnsZone.properties.nameServers

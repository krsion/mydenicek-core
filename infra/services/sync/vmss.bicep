targetScope = 'resourceGroup'

@description('Name of the VMSS.')
param name string

@description('Azure region.')
param location string

@description('Resource ID of the subnet for VMSS NICs.')
param subnetId string

@description('Login server of the ACR (e.g. crmydenicek.azurecr.io).')
param acrLoginServer string

@description('Docker image tag to deploy.')
param imageTag string = 'latest'

@description('Application Insights connection string injected as env var.')
param appInsightsConnStr string

@description('Whether to enable authentication in the app.')
param authEnabled bool = true

@description('Resource tags.')
param tags object = {}

resource vmss 'Microsoft.Compute/virtualMachineScaleSets@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  sku: {
    name: 'Standard_B1s'
    tier: 'Standard'
    capacity: 1
  }
  properties: {
    overprovision: false
    upgradePolicy: {
      mode: 'Rolling'
      rollingUpgradePolicy: {
        maxBatchInstancePercent: 20
        maxUnhealthyInstancePercent: 20
        maxUnhealthyUpgradedInstancePercent: 20
        pauseTimeBetweenBatches: 'PT0S'
      }
    }
    virtualMachineProfile: {
      priority: 'Spot'
      evictionPolicy: 'Deallocate'
      billingProfile: {
        maxPrice: -1
      }
      storageProfile: {
        imageReference: {
          publisher: 'Canonical'
          offer: '0001-com-ubuntu-server-jammy'
          sku: '22_04-lts-gen2'
          version: 'latest'
        }
        osDisk: {
          createOption: 'FromImage'
          managedDisk: {
            storageAccountType: 'Standard_LRS'
          }
          diskSizeGB: 30
        }
      }
      osProfile: {
        computerNamePrefix: 'sync'
        adminUsername: 'azureuser'
        // SSH public key should be injected via Key Vault reference in a real deployment
        // TODO: replace with actual SSH public key or Key Vault reference
        linuxConfiguration: {
          disablePasswordAuthentication: true
          ssh: {
            publicKeys: [
              {
                path: '/home/azureuser/.ssh/authorized_keys'
                // TODO: replace with actual public key value
                keyData: 'TODO_SSH_PUBLIC_KEY'
              }
            ]
          }
        }
      }
      networkProfile: {
        networkInterfaceConfigurations: [
          {
            name: '${name}-nic'
            properties: {
              primary: true
              ipConfigurations: [
                {
                  name: '${name}-ipconfig'
                  properties: {
                    subnet: {
                      id: subnetId
                    }
                  }
                }
              ]
            }
          }
        ]
      }
      extensionProfile: {
        extensions: [
          {
            name: 'CustomScript'
            properties: {
              publisher: 'Microsoft.Azure.Extensions'
              type: 'CustomScript'
              typeHandlerVersion: '2.1'
              autoUpgradeMinorVersion: true
              settings: {
                // Script: login to ACR via managed identity and run the sync container
                script: base64('''
#!/bin/bash
set -e
az login --identity
az acr login --name ${ACR_LOGIN_SERVER}
docker pull ${ACR_LOGIN_SERVER}/sync:${IMAGE_TAG}
docker run -d --restart=unless-stopped \
  -e APPLICATIONINSIGHTS_CONNECTION_STRING="${APPINSIGHTS_CONN_STR}" \
  -e AUTH_ENABLED="${AUTH_ENABLED}" \
  -p 8080:8080 \
  ${ACR_LOGIN_SERVER}/sync:${IMAGE_TAG}
''')
              }
              protectedSettings: {
                commandToExecute: 'ACR_LOGIN_SERVER="${acrLoginServer}" IMAGE_TAG="${imageTag}" APPINSIGHTS_CONN_STR="${appInsightsConnStr}" AUTH_ENABLED="${string(authEnabled)}" bash ./script.sh'
              }
            }
          }
        ]
      }
    }
  }
}

output vmssId string = vmss.id
output principalId string = vmss.identity.principalId

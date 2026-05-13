targetScope = 'resourceGroup'

param location string
param vmssName string
param imageReferenceId string
param containerImage string
@description('SSH public key for VMSS admin user.')
param adminSshPublicKey string
@description('Subnet resource ID for VMSS NIC configuration.')
param subnetResourceId string

var customData = base64('''
#cloud-config
write_files:
  - path: /etc/mydenicek.env
    content: |
      AUTH_ENABLED=false
      // TODO: configure runtime startup and image pull.
runcmd:
  - [ bash, -lc, 'echo "TODO: install container runtime and run ${containerImage}"' ]
''')

resource vmss 'Microsoft.Compute/virtualMachineScaleSets@2024-03-01' = {
  name: vmssName
  location: location
  sku: {
    name: 'Standard_B1s'
    tier: 'Standard'
    capacity: 1
  }
  tags: {
    app: 'mydenicek'
    service: 'sync'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    overprovision: false
    upgradePolicy: {
      mode: 'Manual'
    }
    scaleInPolicy: {
      rules: [
        'OldestVM'
      ]
      forceDeletion: false
    }
    virtualMachineProfile: {
      priority: 'Spot'
      evictionPolicy: 'Deallocate'
      billingProfile: {
        maxPrice: -1
      }
      osProfile: {
        computerNamePrefix: 'sync'
        adminUsername: 'azureuser'
        linuxConfiguration: {
          disablePasswordAuthentication: true
          ssh: {
            publicKeys: [
              {
                path: '/home/azureuser/.ssh/authorized_keys'
                keyData: adminSshPublicKey
              }
            ]
          }
        }
        customData: customData
      }
      storageProfile: {
        imageReference: {
          publisher: 'Canonical'
          offer: '0001-com-ubuntu-server-jammy'
          sku: '22_04-lts'
          version: 'latest'
        }
        osDisk: {
          createOption: 'FromImage'
          managedDisk: {
            storageAccountType: 'Standard_LRS'
          }
        }
      }
      networkProfile: {
        networkInterfaceConfigurations: [
          {
            name: 'nic'
            properties: {
              primary: true
              ipConfigurations: [
                {
                  name: 'ipconfig'
                  properties: {
                    subnet: {
                      id: subnetResourceId
                    }
                  }
                }
              ]
            }
          }
        ]
      }
    }
  }
}

output vmssName string = vmss.name
output principalId string = vmss.identity.principalId

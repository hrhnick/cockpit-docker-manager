// Docker Manager - Volume Management Module (Simplified)
(function() {
    'use strict';

    // Dependencies
    function resources() { return window.DockerManager.resources; }

    // Create resource manager with minimal configuration
    const volumeManager = resources().createResourceManager({
        resourceType: 'volumes',
        resourceName: 'volume',
        dockerCommand: 'volume',
        
        modalConfig: {
            modalId: 'create-volume-modal',
            title: 'Create Volume',
            fields: [
                {
                    name: 'volume-name',
                    label: 'Volume name',
                    type: 'text',
                    placeholder: 'e.g., data, postgres-data',
                    required: true,
                    helperText: 'Name for the Docker volume'
                },
                {
                    name: 'volume-driver',
                    label: 'Driver',
                    type: 'select',
                    options: [
                        { value: 'local', label: 'local' }
                    ],
                    defaultValue: 'local',
                    helperText: 'Volume driver type. Local is the default storage driver.'
                },
                {
                    name: 'volume-driver-opts',
                    label: 'Driver options',
                    type: 'textarea',
                    rows: 5,
                    placeholder: '# Driver options in key=value format (one per line)\n# Example:\n# type=nfs\n# o=addr=10.0.0.1,rw\n# device=:/path/to/directory',
                    helperText: 'Driver-specific options (optional)'
                },
                {
                    name: 'volume-labels',
                    label: 'Labels',
                    type: 'textarea',
                    rows: 3,
                    placeholder: '# Labels in key=value format (one per line)\n# Example:\n# project=myapp\n# environment=production',
                    helperText: 'Labels for organizing and filtering volumes (optional)'
                }
            ],
            validators: {
                'volume-driver-opts': function(value) {
                    return resources().validateKeyValueFormat(value, 'Options');
                },
                'volume-labels': function(value) {
                    return resources().validateKeyValueFormat(value, 'Labels');
                }
            },
            submitLabel: 'Create'
        }
    });

    // Export public interface
    window.DockerManager.volumes = {
        loadVolumes: volumeManager.loadResources,
        renderVolumes: volumeManager.renderResources,
        removeVolume: volumeManager.removeResource,
        pruneVolumes: volumeManager.pruneResources,
        showCreateVolumeModal: volumeManager.showCreateModal,
        hideCreateVolumeModal: volumeManager.hideCreateModal
    };

})();

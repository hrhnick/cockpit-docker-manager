// Docker Manager - Image Management Module (Simplified)
(function() {
    'use strict';

    // Dependencies
    function resources() { return window.DockerManager.resources; }

    // Create resource manager with minimal configuration
    const imageManager = resources().createResourceManager({
        resourceType: 'images',
        resourceName: 'image',
        dockerCommand: 'image',
        
        modalConfig: {
            modalId: 'pull-image-modal',
            title: 'Pull Docker Image',
            fields: [
                {
                    name: 'image-name',
                    label: 'Image name',
                    type: 'text',
                    placeholder: 'nginx:latest',
                    required: true,
                    helperText: 'Full image name including tag (e.g., nginx:latest, postgres:13, myregistry.com/myapp:v1.0)'
                }
            ],
            validators: {
                'image-name': function(value) {
                    if (!value) return 'Image name is required';
                    if (!/^[a-z0-9]+([\/:._-][a-z0-9]+)*$/.test(value)) {
                        return 'Invalid image name format';
                    }
                    return null;
                }
            },
            submitLabel: 'Pull image'
        }
    });

    // Export public interface
    window.DockerManager.images = {
        loadImages: imageManager.loadResources,
        renderImages: imageManager.renderResources,
        removeImage: imageManager.removeResource,
        pruneImages: imageManager.pruneResources,
        showPullImageModal: imageManager.showCreateModal,
        hidePullImageModal: imageManager.hideCreateModal
    };

})();

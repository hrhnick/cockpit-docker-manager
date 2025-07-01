// Docker Manager - Configuration Management Module (Updated with Priority 3 & 4 patterns)
(function() {
    'use strict';

    // Lazy dependency getters
    function app() { return window.DockerManager.app; }
    function utils() { return window.DockerManager.utils; }
    function modals() { return window.DockerManager.modals; }

    // Create settings modal dynamically using DOM utilities (Priority 3)
    function createSettingsModal() {
        if (!window.DockerManager.modals) return null;
        
        const dom = utils().dom;
        
        const modalId = modals().createModal({
            id: 'settings-modal',
            title: 'Settings',
            size: 'medium',
            showFooter: false,
            content: dom.create('form', { id: 'settings-form', noValidate: true }, [
                // Stack Storage Section
                dom.create('div', { className: 'settings-section' }, [
                    dom.create('h4', { 
                        className: 'settings-section-title',
                        textContent: 'Stack Storage' 
                    }),
                    
                    dom.create('div', { className: 'pf-v6-c-form__group' }, [
                        dom.create('label', {
                            className: 'pf-v6-c-form__label',
                            for: 'stacks-path-input',
                            textContent: 'Directory Path'
                        }),
                        dom.create('input', {
                            className: 'pf-v6-c-form__input',
                            type: 'text',
                            id: 'stacks-path-input',
                            name: 'stacks-path',
                            required: true,
                            autocomplete: 'off'
                        }),
                        dom.create('div', {
                            className: 'pf-v6-c-form__helper-text',
                            textContent: 'Where Docker stack configurations are stored. Default: /opt/stacks'
                        })
                    ]),
                    
                    dom.create('div', { className: 'settings-action-group' }, [
                        dom.create('button', {
                            type: 'button',
                            className: 'pf-v6-c-button pf-v6-c-button--secondary has-tooltip',
                            id: 'migrate-stacks-btn',
                            dataset: { 
                                tooltip: 'This will copy all existing stack configurations from the current directory to the new directory. Original files will not be deleted.' 
                            },
                            textContent: 'Migrate Existing Stacks'
                        }),
                        dom.create('div', {
                            className: 'pf-v6-c-form__helper-text',
                            textContent: 'Copy all existing stacks to the new directory before saving'
                        })
                    ])
                ]),
                
                // Backup & Export Section
                dom.create('div', { className: 'settings-section' }, [
                    dom.create('h4', { 
                        className: 'settings-section-title',
                        textContent: 'Backup & Export' 
                    }),
                    dom.create('p', {
                        className: 'settings-section-description',
                        textContent: 'Export your stack configurations for backup or sharing'
                    }),
                    
                    dom.create('div', { className: 'settings-action-group' }, [
                        dom.create('button', {
                            type: 'button',
                            className: 'pf-v6-c-button pf-v6-c-button--secondary has-tooltip',
                            id: 'export-stacks-btn',
                            dataset: {
                                tooltip: 'Creates a compressed archive (.tar.gz) containing all your stack configurations, including docker-compose files and environment variables. The archive can be used to restore stacks on another system.'
                            },
                            textContent: 'Export All Stacks'
                        }),
                        dom.create('div', {
                            className: 'pf-v6-c-form__helper-text',
                            textContent: 'Download a compressed archive containing all stack configurations'
                        })
                    ])
                ]),
                
                // Updates Section
                dom.create('div', { className: 'settings-section' }, [
                    dom.create('h4', { 
                        className: 'settings-section-title',
                        textContent: 'Stack Updates' 
                    }),
                    dom.create('p', {
                        className: 'settings-section-description',
                        textContent: 'Check for updates to Docker images used in your stacks'
                    }),
                    
                    dom.create('div', { className: 'settings-info-box' }, [
                        dom.create('div', { className: 'info-row' }, [
                            dom.create('span', { 
                                className: 'info-label',
                                textContent: 'Last check:' 
                            }),
                            dom.create('span', {
                                id: 'last-update-check',
                                className: 'info-value',
                                textContent: 'Never checked'
                            })
                        ]),
                        dom.create('div', { className: 'info-row' }, [
                            dom.create('span', { 
                                className: 'info-label',
                                textContent: 'Auto-check:' 
                            }),
                            dom.create('span', {
                                className: 'info-value has-tooltip',
                                dataset: {
                                    tooltip: 'Update checks happen automatically once every 24 hours when you open the Docker Manager'
                                },
                                textContent: 'Daily'
                            })
                        ]),
                        dom.create('div', {
                            className: 'info-row',
                            id: 'update-status-row',
                            style: 'display: none;'
                        }, [
                            dom.create('span', { 
                                className: 'info-label',
                                textContent: 'Status:' 
                            }),
                            dom.create('span', {
                                id: 'update-status-value',
                                className: 'info-value',
                                textContent: '0 updates available'
                            })
                        ])
                    ]),
                    
                    dom.create('div', { className: 'settings-button-group' }, [
                        dom.create('button', {
                            type: 'button',
                            className: 'pf-v6-c-button pf-v6-c-button--secondary has-tooltip',
                            id: 'check-updates-btn',
                            dataset: {
                                tooltip: 'Checks all Docker images used in your stacks against their registries to see if newer versions are available'
                            }
                        }, [
                            dom.create('span', {
                                className: 'button-text',
                                textContent: 'Check for Updates'
                            }),
                            dom.create('span', {
                                className: 'button-spinner',
                                style: 'display: none;'
                            }, [
                                dom.create('span', { className: 'spinner-small' }),
                                ' Checking...'
                            ])
                        ]),
                        dom.create('button', {
                            type: 'button',
                            className: 'pf-v6-c-button pf-v6-c-button--primary has-tooltip',
                            id: 'update-all-btn',
                            dataset: {
                                tooltip: 'Pulls the latest images and recreates containers for all stacks that have updates available. Creates a backup before updating.'
                            },
                            textContent: 'Update All Stacks'
                        })
                    ])
                ])
            ]).innerHTML,
            onShow: function() {
                const pathInput = utils().getElement('stacks-path-input');
                pathInput.value = app().stacksPath;
                utils().dom.removeClass(pathInput, 'error');
                
                // Load last update check time and update counts
                loadUpdateCheckData().then(function(data) {
                    const lastCheckElement = utils().getElement('last-update-check');
                    if (data.lastCheck) {
                        const date = new Date(data.lastCheck);
                        lastCheckElement.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                    } else {
                        lastCheckElement.textContent = 'Never checked';
                    }
                    
                    // Count updates available
                    updateUpdateStatusDisplay(data);
                });
                
                // Add settings-specific event handlers
                setupSettingsEventHandlers();
                
                // Initialize tooltips for the modal
                if (window.DockerManager.ui && window.DockerManager.ui.initializeTooltips) {
                    window.DockerManager.ui.initializeTooltips();
                }
            }
        });
        
        // Add custom footer after modal creation
        const modal = utils().getElement(modalId);
        if (modal) {
            const footer = dom.create('footer', { className: 'pf-v6-c-modal__footer' }, [
                dom.create('button', {
                    type: 'button',
                    className: 'pf-v6-c-button pf-v6-c-button--primary',
                    id: 'save-settings-btn',
                    textContent: 'Save Changes'
                }),
                dom.create('button', {
                    type: 'button',
                    className: 'pf-v6-c-button pf-v6-c-button--secondary',
                    id: 'cancel-settings-btn',
                    textContent: 'Cancel'
                })
            ]);
            modal.querySelector('.pf-v6-c-modal__box').appendChild(footer);
        }
        
        return modalId;
    }

    // Setup settings-specific event handlers
    function setupSettingsEventHandlers() {
        const cancelBtn = utils().getElement('cancel-settings-btn');
        const saveBtn = utils().getElement('save-settings-btn');
        const migrateBtn = utils().getElement('migrate-stacks-btn');
        const exportBtn = utils().getElement('export-stacks-btn');
        const checkBtn = utils().getElement('check-updates-btn');
        const updateAllBtn = utils().getElement('update-all-btn');
        
        if (cancelBtn) cancelBtn.addEventListener('click', hideSettingsModal);
        if (saveBtn) saveBtn.addEventListener('click', saveSettings);
        if (migrateBtn) migrateBtn.addEventListener('click', migrateStacks);
        if (exportBtn) exportBtn.addEventListener('click', exportAllStacks);
        if (checkBtn) checkBtn.addEventListener('click', checkForUpdatesWithUI);
        if (updateAllBtn) updateAllBtn.addEventListener('click', function() {
            if (window.DockerManager.stacks && window.DockerManager.stacks.updateAllStacks) {
                window.DockerManager.stacks.updateAllStacks();
            }
        });
    }

    // Initialize modal on first use
    let settingsModalId = null;
    function ensureSettingsModal() {
        if (!settingsModalId || !utils().getElement(settingsModalId)) {
            settingsModalId = createSettingsModal();
        }
    }

    // Configuration management using error handler (Priority 4)
    function loadConfiguration() {
        return utils().errorHandler.handleAsync(
            utils().executeCommand(['cat', app().configPath], { superuser: 'try', suppressError: true }),
            'config-load',
            function(result) {
                try {
                    const config = JSON.parse(result.data);
                    if (config.stacksPath) {
                        app().stacksPath = config.stacksPath;
                    }
                } catch (e) {
                    // Invalid JSON, use defaults
                }
            }
        );
    }

    function saveConfiguration() {
        const config = {
            stacksPath: app().stacksPath
        };
        
        const configContent = JSON.stringify(config, null, 2);
        const encodedContent = btoa(unescape(encodeURIComponent(configContent)));
        
        // Ensure config directory exists
        return utils().executeCommand(['mkdir', '-p', '/etc/cockpit'], { superuser: 'require', suppressError: true })
            .then(function() {
                const writeCommand = 'echo "' + encodedContent + '" | base64 -d > "' + app().configPath + '"';
                return utils().executeCommand(['sh', '-c', writeCommand], { superuser: 'require' });
            });
    }

    // Update check management
    function loadUpdateCheckData() {
        return utils().errorHandler.handleAsync(
            utils().executeCommand(['cat', app().updateCheckPath], { superuser: 'try', suppressError: true }),
            'update-check-load',
            function(result) {
                try {
                    return JSON.parse(result.data);
                } catch (e) {
                    return { lastCheck: 0, updates: {} };
                }
            },
            function() {
                return { lastCheck: 0, updates: {} };
            }
        );
    }

    function saveUpdateCheckData(data) {
        const content = JSON.stringify(data, null, 2);
        const encodedContent = btoa(unescape(encodeURIComponent(content)));
        
        // Ensure directory exists
        return utils().executeCommand(['mkdir', '-p', '/etc/cockpit'], { superuser: 'require', suppressError: true })
            .then(function() {
                const writeCommand = 'echo "' + encodedContent + '" | base64 -d > "' + app().updateCheckPath + '"';
                return utils().executeCommand(['sh', '-c', writeCommand], { superuser: 'require' });
            });
    }

    function shouldCheckForUpdates() {
        return loadUpdateCheckData()
            .then(function(data) {
                const now = Date.now();
                const lastCheck = data.lastCheck || 0;
                const oneDayInMs = 24 * 60 * 60 * 1000;
                
                return now - lastCheck > oneDayInMs;
            });
    }

    // Load update status from saved data
    function loadUpdateStatus() {
        return loadUpdateCheckData()
            .then(function(data) {
                if (data.updates) {
                    Object.keys(data.updates).forEach(function(stackName) {
                        const update = data.updates[stackName];
                        app().stackUpdates[stackName] = update.hasUpdates || false;
                    });
                }
            });
    }

    // Stack export functionality using batch operations (Priority 3)
    function exportAllStacks() {
        const exportBtn = utils().getElement('export-stacks-btn');
        
        if (!exportBtn) return;
        
        exportBtn.disabled = true;
        exportBtn.textContent = 'Creating export...';
        
        utils().showNotification('Creating stack export...', 'info');
        
        // Create timestamp for filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const exportFileName = 'docker-stacks-backup-' + timestamp + '.tar.gz';
        const tempDir = '/tmp/docker-stacks-export-' + Date.now();
        const exportPath = '/tmp/' + exportFileName;
        
        const tasks = [
            // Check if stacks directory exists
            function() {
                return utils().executeCommand(['test', '-d', app().stacksPath], { superuser: 'try', suppressError: true })
                    .then(function(result) {
                        if (!result.success) {
                            throw new Error('Stacks directory does not exist');
                        }
                    });
            },
            // Check if there are any stacks
            function() {
                return utils().executeCommand(['find', app().stacksPath, '-maxdepth', '1', '-type', 'd', '-not', '-path', app().stacksPath], 
                    { superuser: 'try', suppressError: true })
                    .then(function(result) {
                        if (!result.success || !result.data.trim()) {
                            throw new Error('No stacks found to export');
                        }
                    });
            },
            // Create temporary directory
            function() {
                return utils().executeCommand(['mkdir', '-p', tempDir], { superuser: 'require' })
                    .then(function(result) {
                        if (!result.success) {
                            throw new Error('Failed to create temporary directory');
                        }
                    });
            },
            // Copy all stacks to temp directory
            function() {
                return utils().executeCommand(['cp', '-r', app().stacksPath + '/.', tempDir + '/'], { superuser: 'require' })
                    .then(function(result) {
                        if (!result.success) {
                            throw new Error('Failed to copy stack files');
                        }
                    });
            },
            // Create README file
            function() {
                const readmeContent = 'Docker Stacks Backup\\n' +
                    '=====================\\n\\n' +
                    'Exported on: ' + new Date().toISOString() + '\\n' +
                    'Source path: ' + app().stacksPath + '\\n\\n' +
                    'To restore these stacks:\\n' +
                    '1. Extract this archive to your desired stacks directory\\n' +
                    '2. Update the Docker Manager settings to point to the new directory\\n' +
                    '3. Start your stacks as needed\\n\\n' +
                    'Each subdirectory contains a complete Docker stack configuration.\\n';
                
                const writeReadmeCommand = 'echo -e "' + readmeContent + '" > "' + tempDir + '/README.txt"';
                return utils().executeCommand(['sh', '-c', writeReadmeCommand], { superuser: 'require' });
            },
            // Create tar.gz archive
            function() {
                return utils().executeCommand([
                    'tar', '-czf', exportPath, '-C', tempDir, '.'
                ], { superuser: 'require' })
                    .then(function(result) {
                        if (!result.success) {
                            throw new Error('Failed to create archive');
                        }
                    });
            },
            // Read the file for download
            function() {
                return utils().executeCommand(['base64', '-w', '0', exportPath], { superuser: 'require' })
                    .then(function(result) {
                        if (!result.success) {
                            throw new Error('Failed to read export file');
                        }
                        
                        // Trigger download
                        downloadFile(result.data, exportFileName, 'application/gzip', true);
                        utils().showNotification('Stack export downloaded successfully', 'success');
                    });
            }
        ];
        
        utils().batchOperations.processSequentially(tasks, function(task) {
            return task();
        }).catch(function(error) {
            const errorMsg = error.message || 'Failed to export stacks';
            utils().showNotification('Export failed: ' + errorMsg, 'error');
        }).finally(function() {
            // Clean up temporary files
            utils().executeCommand(['rm', '-rf', tempDir, exportPath], { superuser: 'require', suppressError: true });
            
            // Restore button state
            exportBtn.disabled = false;
            exportBtn.textContent = 'Export All Stacks';
        });
    }

    // Helper function to trigger file download
    function downloadFile(data, filename, mimeType, isBase64) {
        try {
            let blob;
            
            if (isBase64) {
                // Decode base64 data
                const binaryString = atob(data.trim());
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                blob = new Blob([bytes], { type: mimeType });
            } else {
                // Direct data
                blob = new Blob([data], { type: mimeType });
            }
            
            // Create download link
            const url = window.URL.createObjectURL(blob);
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = filename;
            downloadLink.style.display = 'none';
            
            // Trigger download
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            
            // Clean up object URL
            setTimeout(function() {
                window.URL.revokeObjectURL(url);
            }, 100);
        } catch (error) {
            // Fallback: show instructions for manual download
            utils().showNotification('Download prepared. Check /tmp/' + filename + ' on the server', 'info');
        }
    }

    // Settings modal functions
    function showSettingsModal() {
        ensureSettingsModal();
        if (modals() && settingsModalId) {
            modals().showModal(settingsModalId);
        }
    }
    
    // Helper function to update the status display
    function updateUpdateStatusDisplay(data) {
        const dom = utils().dom;
        let updateCount = 0;
        
        if (data && data.updates) {
            Object.keys(data.updates).forEach(function(stackName) {
                if (data.updates[stackName].hasUpdates) {
                    updateCount++;
                }
            });
        }
        
        const statusRow = utils().getElement('update-status-row');
        const statusValue = utils().getElement('update-status-value');
        
        if (statusRow && statusValue) {
            if (updateCount > 0) {
                dom.toggle(statusRow, true);
                statusValue.textContent = updateCount + ' stack' + (updateCount !== 1 ? 's' : '') + ' with updates available';
                statusValue.style.color = 'var(--pf-global--warning-color--100)';
            } else if (data && data.lastCheck) {
                dom.toggle(statusRow, true);
                statusValue.textContent = 'All stacks up to date';
                statusValue.style.color = 'var(--pf-global--success-color--100)';
            } else {
                dom.toggle(statusRow, false);
            }
        }
    }

    function hideSettingsModal() {
        if (modals() && settingsModalId) {
            modals().hideModal(settingsModalId);
        }
    }

    // Validate stacks path using validators (Priority 3)
    function validateStacksPath(path) {
        if (!path) {
            return 'Path cannot be empty';
        }
        if (path[0] !== '/') {
            return 'Path must be absolute (start with /)';
        }
        if (path.includes('..')) {
            return 'Path cannot contain ".."';
        }
        if (path.includes(' ')) {
            return 'Path cannot contain spaces';
        }
        return null;
    }

    // Save settings using error handler (Priority 4)
    function saveSettings() {
        const pathInput = utils().getElement('stacks-path-input');
        const newPath = pathInput.value.trim();
        const saveBtn = utils().getElement('save-settings-btn');
        const dom = utils().dom;
        
        dom.removeClass(pathInput, 'error');
        
        const error = validateStacksPath(newPath);
        if (error) {
            dom.addClass(pathInput, 'error');
            utils().showNotification(error, 'error');
            return;
        }
        
        if (newPath === app().stacksPath) {
            hideSettingsModal();
            return;
        }
        
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        
        // Create new directory if needed
        utils().errorHandler.handleAsync(
            utils().executeCommand(['mkdir', '-p', newPath], { superuser: 'require' }),
            'settings-save',
            function() {
                app().stacksPath = newPath;
                return saveConfiguration();
            }
        ).then(function(result) {
            if (result && result.success) {
                hideSettingsModal();
                utils().showNotification('Settings saved successfully', 'success');
                if (window.DockerManager.stacks && window.DockerManager.stacks.loadStacks) {
                    window.DockerManager.stacks.loadStacks();
                }
            } else {
                throw new Error('Failed to save configuration');
            }
        }).catch(function(error) {
            dom.addClass(pathInput, 'error');
            utils().showNotification(error.message || 'Failed to save settings', 'error');
        }).finally(function() {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
        });
    }

    // Migrate stacks using batch operations (Priority 3)
    function migrateStacks() {
        const pathInput = utils().getElement('stacks-path-input');
        const newPath = pathInput.value.trim();
        const migrateBtn = utils().getElement('migrate-stacks-btn');
        const dom = utils().dom;
        
        const error = validateStacksPath(newPath);
        if (error) {
            dom.addClass(pathInput, 'error');
            utils().showNotification(error, 'error');
            return;
        }
        
        if (newPath === app().stacksPath) {
            utils().showNotification('Source and destination paths are the same', 'warning');
            return;
        }
        
        modals().confirm('Copy all stacks from "' + app().stacksPath + '" to "' + newPath + '"? This will not remove the original files.', {
            title: 'Migrate Stacks',
            confirmLabel: 'Migrate',
            cancelLabel: 'Cancel'
        }).then(function(confirmed) {
            if (!confirmed) return;
            
            migrateBtn.disabled = true;
            migrateBtn.textContent = 'Migrating...';
            
            utils().showNotification('Migrating stacks...', 'info');
            
            const tasks = [
                // Create destination directory
                function() {
                    return utils().executeCommand(['mkdir', '-p', newPath], { superuser: 'require' })
                        .then(function(result) {
                            if (!result.success) {
                                throw new Error('Failed to create destination directory');
                            }
                        });
                },
                // Copy all stacks
                function() {
                    return utils().executeCommand(['cp', '-r', app().stacksPath + '/.', newPath + '/'], { superuser: 'require' })
                        .then(function(result) {
                            if (!result.success) {
                                throw new Error('Failed to copy stacks');
                            }
                            utils().showNotification('Stacks migrated successfully', 'success');
                        });
                }
            ];
            
            utils().batchOperations.processSequentially(tasks, function(task) {
                return task();
            }).catch(function(error) {
                utils().showNotification(error.message || 'Migration failed', 'error');
            }).finally(function() {
                migrateBtn.disabled = false;
                migrateBtn.textContent = 'Migrate Existing Stacks';
            });
        });
    }

    // Enhanced check for updates with loading state
    function checkForUpdatesWithUI() {
        const checkBtn = utils().getElement('check-updates-btn');
        if (!checkBtn) return;
        
        // Add loading state
        utils().dom.addClass(checkBtn, 'is-loading');
        checkBtn.disabled = true;
        
        // Perform the check
        if (window.DockerManager.stacks && window.DockerManager.stacks.checkAllStacksForUpdates) {
            window.DockerManager.stacks.checkAllStacksForUpdates(true)
                .then(function(updateData) {
                    // Update the display with results
                    if (updateData) {
                        updateUpdateStatusDisplay(updateData);
                        
                        // Update last check time
                        const lastCheckElement = utils().getElement('last-update-check');
                        if (lastCheckElement) {
                            const date = new Date(updateData.lastCheck);
                            lastCheckElement.textContent = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                        }
                    }
                })
                .finally(function() {
                    // Remove loading state
                    utils().dom.removeClass(checkBtn, 'is-loading');
                    checkBtn.disabled = false;
                });
        } else {
            // Remove loading state if stacks module not loaded
            utils().dom.removeClass(checkBtn, 'is-loading');
            checkBtn.disabled = false;
            utils().showNotification('Unable to check for updates', 'error');
        }
    }

    // Export public interface
    window.DockerManager.config = {
        loadConfiguration: loadConfiguration,
        saveConfiguration: saveConfiguration,
        loadUpdateCheckData: loadUpdateCheckData,
        saveUpdateCheckData: saveUpdateCheckData,
        shouldCheckForUpdates: shouldCheckForUpdates,
        loadUpdateStatus: loadUpdateStatus,
        exportAllStacks: exportAllStacks,
        showSettingsModal: showSettingsModal,
        hideSettingsModal: hideSettingsModal,
        saveSettings: saveSettings,
        migrateStacks: migrateStacks,
        checkForUpdatesWithUI: checkForUpdatesWithUI
    };

})();

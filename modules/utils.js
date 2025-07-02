// Docker Manager - Utility Functions Module (Cleaned and Optimized)
(function() {
    'use strict';

    // Initialize namespace if needed
    window.DockerManager = window.DockerManager || {};
    
    // Cache for docker-compose command
    let dockerComposeCommandCache = null;
    
    // Core utility functions
    function executeCommand(command, options) {
        options = options || {};
        return cockpit.spawn(command, options)
            .then(function(result) {
                return { success: true, data: result };
            })
            .catch(function(error) {
                // For commands that exit with non-zero status, the output might be in the message
                let errorMessage = error.message || error.toString();
                
                // Cockpit sometimes puts the actual command output in the 'details' field
                if (error.details && typeof error.details === 'string') {
                    errorMessage = error.details;
                }
                
                // Check if the error contains actual output (common with docker-compose errors)
                if (error.problem === 'non-zero-exit-status' && errorMessage) {
                    // The actual error output is in the message
                    return { success: false, error: errorMessage, data: errorMessage };
                }
                
                // Check if there's useful error info in the message that looks like YAML errors
                if (errorMessage.includes('yaml:') || errorMessage.includes('mapping values')) {
                    return { success: false, error: errorMessage, data: errorMessage };
                }
                
                return { success: false, error: errorMessage };
            });
    }

    // New streaming command executor for real-time output
    function executeCommandStreaming(command, options, callbacks) {
        options = options || {};
        callbacks = callbacks || {};
        
        const proc = cockpit.spawn(command, options);
        let output = '';
        let error = '';
        let allOutput = []; // Store all output lines for error analysis
        let yamlError = null; // Track multi-line YAML errors
        
        if (callbacks.onOutput) {
            proc.stream(function(data) {
                output += data;
                // Process line by line
                const lines = data.split('\n');
                lines.forEach(function(line) {
                    if (line.trim()) {
                        allOutput.push(line);
                        
                        // Check if this is the start of a YAML error
                        if (line.includes('yaml:') && line.includes('line')) {
                            yamlError = line;
                        } else if (yamlError && line.trim() && !line.match(/^\s*\^/)) {
                            // If we have a YAML error and this line continues it
                            yamlError += ' ' + line.trim();
                        }
                        
                        callbacks.onOutput(line);
                    }
                });
            });
        }
        
        if (callbacks.onError) {
            proc.fail(function(err) {
                const errorMessage = err.message || err.toString() || err;
                error = errorMessage;
                callbacks.onError(errorMessage);
            });
        }
        
        return proc.then(function() {
            return { success: true, data: output };
        }).catch(function(err) {
            // Try to find a meaningful error message from the output
            let errorMessage = error || err.message || err.toString() || err;
            
            // If we captured a YAML error, use that
            if (yamlError) {
                errorMessage = yamlError;
            } else if (allOutput.length > 0 && (!errorMessage || errorMessage === 'non-zero exit status')) {
                // Look for error patterns in the output
                const errorLine = allOutput.find(function(line) {
                    return line.includes('yaml:') || 
                           line.includes('error:') || 
                           line.includes('Error:') ||
                           line.includes('mapping values') ||
                           line.includes('failed') ||
                           line.includes('cannot') ||
                           line.includes('ERROR') ||
                           line.includes('Invalid') ||
                           line.includes('Unknown');
                });
                
                if (errorLine) {
                    errorMessage = errorLine.trim();
                }
            }
            
            return { success: false, error: errorMessage, data: output };
        });
    }

    function getElement(id) {
        return document.getElementById(id);
    }

    // Unified notification system
    function showNotification(message, type, options) {
        type = type || 'info';
        options = options || {};
        const banner = getElement('action-banner');
        if (banner) {
            banner.textContent = message;
            banner.className = type;
            banner.style.display = 'block';
            
            // Don't auto-hide if persist is true
            if (!options.persist) {
                // Clear any existing timeout
                if (banner.hideTimeout) {
                    clearTimeout(banner.hideTimeout);
                }
                
                // Error messages stay longer by default
                const duration = options.duration || (type === 'error' ? 8000 : 4000);
                
                banner.hideTimeout = setTimeout(function() {
                    banner.style.display = 'none';
                    banner.hideTimeout = null;
                }, duration);
            }
        }
    }

    function hideProgressNotification() {
        const banner = getElement('action-banner');
        if (banner) {
            setTimeout(function() {
                banner.style.display = 'none';
            }, 2000);
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Simplified DOM manipulation utilities
    const dom = {
        // Enhanced element creation
        create: function(tag, attrs, children) {
            const el = document.createElement(tag);
            
            if (attrs) {
                Object.entries(attrs).forEach(([key, value]) => {
                    if (key === 'className') {
                        el.className = value;
                    } else if (key === 'textContent') {
                        el.textContent = value;
                    } else if (key === 'innerHTML') {
                        el.innerHTML = value;
                    } else if (key === 'dataset') {
                        Object.assign(el.dataset, value);
                    } else if (key === 'style' && typeof value === 'object') {
                        Object.assign(el.style, value);
                    } else if (key.startsWith('on') && typeof value === 'function') {
                        el.addEventListener(key.slice(2).toLowerCase(), value);
                    } else {
                        el.setAttribute(key, value);
                    }
                });
            }
            
            if (children) {
                this.append(el, children);
            }
            
            return el;
        },

        // Add loading state to element
        setLoading: function(el, isLoading, loadingText) {
            if (typeof el === 'string') el = getElement(el);
            if (!el) return;
            
            if (isLoading) {
                el.disabled = true;
                el.classList.add('is-loading');
                if (loadingText && el.dataset.originalText === undefined) {
                    el.dataset.originalText = el.textContent;
                    el.textContent = loadingText;
                }
            } else {
                el.disabled = false;
                el.classList.remove('is-loading');
                if (el.dataset.originalText !== undefined) {
                    el.textContent = el.dataset.originalText;
                    delete el.dataset.originalText;
                }
            }
        },

        // Efficient append with fragment support
        append: function(parent, children) {
            if (!Array.isArray(children)) {
                children = [children];
            }
            
            // Use fragment for multiple children
            if (children.length > 1) {
                const fragment = document.createDocumentFragment();
                children.forEach(child => {
                    if (typeof child === 'string') {
                        fragment.appendChild(document.createTextNode(child));
                    } else if (child instanceof Node) {
                        fragment.appendChild(child);
                    }
                });
                parent.appendChild(fragment);
            } else {
                children.forEach(child => {
                    if (typeof child === 'string') {
                        parent.appendChild(document.createTextNode(child));
                    } else if (child instanceof Node) {
                        parent.appendChild(child);
                    }
                });
            }
        },

        toggle: function(el, show) {
            if (typeof el === 'string') el = getElement(el);
            if (el) {
                el.style.display = show ? '' : 'none';
            }
        },

        updateText: function(id, text) {
            const el = getElement(id);
            if (el) el.textContent = text;
        },

        addClass: function(el, className) {
            if (typeof el === 'string') el = getElement(el);
            if (el) el.classList.add(className);
        },

        removeClass: function(el, className) {
            if (typeof el === 'string') el = getElement(el);
            if (el) el.classList.remove(className);
        },

        toggleClass: function(el, className, force) {
            if (typeof el === 'string') el = getElement(el);
            if (el) el.classList.toggle(className, force);
        },

        hasClass: function(el, className) {
            if (typeof el === 'string') el = getElement(el);
            return el ? el.classList.contains(className) : false;
        },

        // Query utilities
        query: function(selector, parent) {
            return (parent || document).querySelector(selector);
        },

        queryAll: function(selector, parent) {
            return Array.from((parent || document).querySelectorAll(selector));
        }
    };

    // Unified validation system
    const validators = {
        required: function(value, label) {
            return !value ? (label || 'Field') + ' is required' : null;
        },

        pattern: function(value, pattern, message) {
            return !pattern.test(value) ? message : null;
        },

        resourceName: function(value, resourceType) {
            if (!value) return (resourceType || 'Resource') + ' name is required';
            if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) {
                return 'Must start with letter/number. Use only letters, numbers, dots, hyphens, underscores';
            }
            return null;
        },

        keyValue: function(value, fieldName) {
            if (!value) return null; // Optional field
            const lines = value.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line && !line.startsWith('#') && !line.includes('=')) {
                    return 'Line ' + (i + 1) + ': ' + (fieldName || 'Field') + ' must be in key=value format';
                }
            }
            return null;
        },

        imageName: function(value) {
            if (!value) return 'Image name is required';
            if (!/^[a-z0-9]+([\/:._-][a-z0-9]+)*$/.test(value)) {
                return 'Invalid image name format';
            }
            return null;
        }
    };

    // Enhanced Docker command builders to handle all cases
    const dockerCommands = {
        compose: function(stack, action, options) {
            const workDir = window.DockerManager.app.stacksPath + '/' + stack;
            const args = [].concat(action, options || []);
            return {
                stack: stack,
                workDir: workDir,
                action: action,
                args: args,
                options: { superuser: 'require' }
            };
        },

        container: function(action, id, options) {
            return {
                command: ['docker', 'container', action, id].concat(options || []),
                options: { superuser: 'try' }
            };
        },

        resource: function(type, action, args, options) {
            return {
                command: ['docker', type, action].concat(args || []),
                options: options || { superuser: 'require' }
            };
        },
        
        // New: Direct command builder for simple docker commands
        docker: function(subcommand, args, options) {
            return {
                command: ['docker'].concat(subcommand).concat(args || []),
                options: options || { superuser: 'try' }
            };
        },
        
        // New: Build a docker compose command array
        buildCompose: function(stack, action, extraArgs) {
            return getDockerComposeCommand().then(function(baseCommand) {
                const workDir = window.DockerManager.app.stacksPath + '/' + stack;
                const fullCommand = ['sh', '-c', 'cd "' + workDir + '" && ' + baseCommand + ' ' + action.join(' ') + (extraArgs ? ' ' + extraArgs : '') + ' 2>&1'];
                return fullCommand;
            });
        },
        
        // New: Build a systemctl command
        systemctl: function(action, service, options) {
            return {
                command: ['systemctl', action, service],
                options: options || { superuser: 'require' }
            };
        }
    };

    // Unified error handling
    const errorHandler = {
        handle: function(error, context) {
            const message = this.parse(error, context);
            showNotification(message, 'error');
            return message;
        },

        handleAsync: function(promise, context, onSuccess, onError) {
            return promise
                .then(function(result) {
                    if (result.success) {
                        if (onSuccess) return onSuccess(result);
                        return result;
                    } else {
                        const msg = errorHandler.parse(result.error, context);
                        if (onError) return onError(msg, result);
                        showNotification(msg, 'error');
                        return result;
                    }
                })
                .catch(function(error) {
                    const msg = errorHandler.parse(error, context);
                    if (onError) return onError(msg, { success: false, error: error });
                    showNotification(msg, 'error');
                    return { success: false, error: error };
                });
        },

        parse: function(error, context) {
            // Use existing parseDockerError for Docker-specific errors
            if (context && context.includes('docker')) {
                return parseDockerError(error);
            }
            
            // Generic error parsing
            if (typeof error === 'object' && error.message) {
                return error.message;
            }
            
            return error ? error.toString() : 'Unknown error';
        }
    };

    // Batch operations framework
    const batchOperations = {
        processSequentially: function(items, operation, delay) {
            const results = [];
            let index = 0;
            
            function processNext() {
                if (index >= items.length) {
                    return Promise.resolve(results);
                }
                
                const item = items[index++];
                return Promise.resolve(operation(item))
                    .then(function(result) {
                        results.push(result);
                        if (delay) {
                            return new Promise(function(resolve) {
                                setTimeout(function() {
                                    resolve(processNext());
                                }, delay);
                            });
                        }
                        return processNext();
                    })
                    .catch(function(error) {
                        results.push({ error: error, item: item });
                        return processNext();
                    });
            }
            
            return processNext();
        },

        processParallel: function(items, operation, batchSize) {
            batchSize = batchSize || 5;
            const results = [];
            
            function processBatch(startIndex) {
                if (startIndex >= items.length) {
                    return Promise.resolve(results);
                }
                
                const batch = items.slice(startIndex, startIndex + batchSize);
                const promises = batch.map(function(item) {
                    return Promise.resolve(operation(item))
                        .catch(function(error) {
                            return { error: error, item: item };
                        });
                });
                
                return Promise.all(promises)
                    .then(function(batchResults) {
                        results.push.apply(results, batchResults);
                        return processBatch(startIndex + batchSize);
                    });
            }
            
            return processBatch(0);
        },

        delay: function(ms) {
            return new Promise(function(resolve) {
                setTimeout(resolve, ms);
            });
        }
    };

    // Simplified Docker error parsing
    function parseDockerError(error) {
        if (!error) return 'Unknown error';
        
        // Convert error to string if it's not already
        let errorStr = error;
        if (typeof error === 'object') {
            if (error.message) {
                errorStr = error.message;
            } else if (error.toString && error.toString() !== '[object Object]') {
                errorStr = error.toString();
            } else {
                errorStr = JSON.stringify(error);
            }
        } else if (typeof error !== 'string') {
            errorStr = String(error);
        }
        
        // If it's just a generic exit status message, return something more helpful
        if (errorStr === 'non-zero exit status' || errorStr === 'exit status 1') {
            return 'Command failed - check the configuration for errors';
        }
        
        // Common Docker error patterns (consolidated)
        const errorPatterns = [
            // Port conflicts
            { pattern: /bind.*address already in use/, extract: /bind: (.+)$/, message: 'Port conflict: ' },
            { pattern: /port is already allocated/, extract: /port (\d+)/, message: 'Port already in use: ' },
            
            // Network errors
            { pattern: /no such host/, message: 'DNS resolution failed - check network connection' },
            { pattern: /timeout/, message: 'Operation timed out - check network connection' },
            
            // Image errors
            { pattern: /pull access denied/, message: 'Cannot pull image - access denied or not found' },
            { pattern: /manifest.*not found/, message: 'Image not found in registry' },
            { pattern: /unauthorized/, message: 'Authentication required - image may be private' },
            
            // Volume/Mount errors
            { pattern: /no such file or directory/, extract: /no such file or directory.*"(.+)"/, message: 'Path not found: ' },
            
            // Resource errors
            { pattern: /no space left on device/, message: 'No disk space available' },
            { pattern: /cannot allocate memory/, message: 'Insufficient memory' },
            
            // Permission errors
            { pattern: /permission denied/, message: 'Permission denied' },
            
            // Compose file errors
            { pattern: /yaml:.*line \d+/, extract: /(yaml:.*line \d+:.*)/, message: '' },
            { pattern: /mapping values are not allowed/, extract: /(.*line \d+:.*mapping values are not allowed.*)/, message: '' },
            
            // Service errors
            { pattern: /no such service/, extract: /no such service: (.+)/, message: 'Service not found: ' }
        ];
        
        // Try to match against known patterns
        for (let i = 0; i < errorPatterns.length; i++) {
            const pattern = errorPatterns[i];
            if (pattern.pattern.test(errorStr)) {
                if (pattern.extract) {
                    const match = errorStr.match(pattern.extract);
                    if (match && match[1]) {
                        return pattern.message + match[1];
                    }
                }
                return pattern.message + (pattern.extract ? errorStr : '');
            }
        }
        
        // Extract "Error response from daemon:" messages
        const daemonMatch = errorStr.match(/Error response from daemon: (.+)/);
        if (daemonMatch) {
            return daemonMatch[1];
        }
        
        // Look for ERROR: prefixed messages
        const errorMatch = errorStr.match(/ERROR:\s*(.+)/);
        if (errorMatch) {
            return errorMatch[1];
        }
        
        // If no pattern matched, try to extract the most relevant line
        const lines = errorStr.split('\n').filter(function(line) {
            return line.trim() && !line.includes('docker compose') && !line.includes('docker-compose');
        });
        
        // Look for lines with error indicators
        const errorLine = lines.find(function(line) {
            const lowerLine = line.toLowerCase();
            return lowerLine.includes('error') || 
                   lowerLine.includes('failed') ||
                   lowerLine.includes('cannot') ||
                   line.includes('yaml:') ||
                   line.includes('mapping values') ||
                   line.includes('invalid') ||
                   line.includes('unknown') ||
                   line.includes('unsupported');
        });
        
        // If we found an error line, return it
        if (errorLine) {
            return errorLine.trim();
        }
        
        // Otherwise, return the first non-empty line or a generic message
        const firstLine = lines.find(function(line) { return line.trim(); });
        return firstLine || 'Operation failed - check configuration';
    }

    // Parse docker-compose output for progress updates
    function parseDockerComposeProgress(line, stackName) {
        // Skip empty lines
        if (!line.trim()) return null;
        
        // Check for errors first (consolidated checks)
        const errorIndicators = ['yaml:', 'YAML:', 'mapping values are not allowed', 'ERROR:', 'Error:', 
                               'error:', 'failed to', 'Failed to', 'Error response from daemon', 
                               'invalid reference format', 'Unknown key', 'Invalid interpolation', 
                               'Unsupported config option', 'services must be a mapping', 
                               'Cannot locate specified Dockerfile', 'build path', 'no such file or directory'];
        
        const hasError = errorIndicators.some(indicator => line.includes(indicator));
        if (hasError) {
            return {
                type: 'error',
                message: line.trim(),
                isError: true
            };
        }
        
        // Check for warning that might indicate errors
        if (line.includes('WARNING:') && (line.includes('no such service') || line.includes('orphan'))) {
            return {
                type: 'error',
                message: line.trim().replace('WARNING:', 'Error:'),
                isError: true
            };
        }
        
        // Image pull progress
        if (line.includes('Pulling from') || line.includes('Pull complete')) {
            const imageMatch = line.match(/(\S+):\s*(Pulling from .+|Pull complete)/);
            if (imageMatch) {
                return {
                    type: 'image-pull',
                    message: imageMatch[1] + ': ' + imageMatch[2]
                };
            }
        }
        
        // Download progress
        if (line.includes('Downloading') || line.includes('Extracting')) {
            const progressMatch = line.match(/(\S+):\s*(Downloading|Extracting)\s*\[([=>-]+)\]\s*(.+)/);
            if (progressMatch) {
                return {
                    type: 'download-progress',
                    message: progressMatch[1] + ': ' + progressMatch[2] + ' ' + progressMatch[4]
                };
            }
        }
        
        // Container operations
        if (line.includes('Creating') || line.includes('Starting') || line.includes('Stopping')) {
            const containerMatch = line.match(/(Creating|Starting|Stopping)\s+(\S+)/);
            if (containerMatch) {
                return {
                    type: 'container-operation',
                    message: containerMatch[1] + ' container: ' + containerMatch[2]
                };
            }
        }
        
        // Network operations
        if (line.includes('Creating network')) {
            return {
                type: 'network-operation',
                message: line.trim()
            };
        }
        
        // Volume operations
        if (line.includes('Creating volume')) {
            return {
                type: 'volume-operation',
                message: line.trim()
            };
        }
        
        // Generic status - don't report every line, just meaningful ones
        if (line.trim() && !line.startsWith(' ') && !line.match(/^\s*\d+\s*$/) && !line.includes('...')) {
            return {
                type: 'status',
                message: line.trim()
            };
        }
        
        return null;
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        
        try {
            const date = new Date(dateStr);
            const now = new Date();
            const diffMs = now - date;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) {
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                if (diffHours === 0) {
                    const diffMinutes = Math.floor(diffMs / (1000 * 60));
                    if (diffMinutes === 0) {
                        return 'Just now';
                    }
                    return diffMinutes + ' minute' + (diffMinutes > 1 ? 's' : '') + ' ago';
                }
                return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
            } else if (diffDays < 30) {
                return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';
            } else {
                return date.toLocaleDateString();
            }
        } catch (e) {
            return 'Unknown';
        }
    }

    // Docker Compose command handling
    function getDockerComposeCommand() {
        // Return cached value if available
        if (dockerComposeCommandCache !== null) {
            return Promise.resolve(dockerComposeCommandCache);
        }
        
        // Check if we should use 'docker-compose' or 'docker compose'
        return executeCommand(['which', 'docker-compose'], { suppressError: true })
            .then(function(result) {
                if (result.success) {
                    dockerComposeCommandCache = 'docker-compose';
                    return 'docker-compose';  // v1 found
                } else {
                    dockerComposeCommandCache = 'docker compose';
                    return 'docker compose';  // Fall back to v2
                }
            });
    }

    // Enhanced runDockerCompose that properly handles the compose command structure
    function runDockerCompose(stackName, args, options) {
        options = options || {};
        const app = window.DockerManager.app;
        const workDir = app.stacksPath + '/' + stackName;
        
        return getDockerComposeCommand()
            .then(function(baseCommand) {
                // Change to stack directory and run command, redirect stderr to stdout to capture all output
                const fullCommand = ['sh', '-c', 'cd "' + workDir + '" && ' + baseCommand + ' ' + args.join(' ') + ' 2>&1'];
                const commandOptions = { superuser: 'require' };
                if (options.suppressError) {
                    commandOptions.suppressError = true;
                }
                return executeCommand(fullCommand, commandOptions);
            })
            .catch(function(error) {
                return { success: false, error: error.message || error.toString() };
            });
    }

    // Enhanced Docker Compose command with streaming
    function runDockerComposeStreaming(stackName, args, callbacks) {
        const app = window.DockerManager.app;
        const workDir = app.stacksPath + '/' + stackName;
        
        return getDockerComposeCommand()
            .then(function(baseCommand) {
                const fullCommand = ['sh', '-c', 'cd "' + workDir + '" && ' + baseCommand + ' ' + args.join(' ') + ' 2>&1'];
                const commandOptions = { superuser: 'require' };
                
                let errorMessages = [];
                
                return executeCommandStreaming(fullCommand, commandOptions, {
                    onOutput: function(line) {
                        const progress = parseDockerComposeProgress(line, stackName);
                        if (progress) {
                            if (progress.isError) {
                                errorMessages.push(progress.message);
                            }
                            if (callbacks.onProgress) {
                                callbacks.onProgress(progress);
                            }
                        }
                        
                        // Also check for errors in regular output
                        if (progress && progress.isError && callbacks.onError) {
                            callbacks.onError(progress.message);
                        }
                    },
                    onError: function(error) {
                        if (callbacks.onError) {
                            callbacks.onError(error);
                        }
                    }
                }).then(function(result) {
                    // If we collected error messages but result says success, mark as failure
                    if (result.success && errorMessages.length > 0) {
                        return {
                            success: false,
                            error: errorMessages.join('\n'),
                            data: result.data
                        };
                    }
                    return result;
                });
            });
    }

    // Simplified YAML validation without highlighting
    function validateYamlContent(content) {
        if (!content || !content.trim()) {
            return { valid: false, error: 'Content cannot be empty' };
        }
        
        // Basic YAML validation checks
        const lines = content.split('\n');
        let currentIndent = 0;
        let inListContext = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            
            // Skip empty lines and comments
            if (!trimmedLine || trimmedLine.startsWith('#')) continue;
            
            // Check for tabs (YAML doesn't allow tabs for indentation)
            if (line.includes('\t')) {
                return { 
                    valid: false, 
                    error: `Line ${i + 1}: YAML does not allow tabs for indentation. Use spaces instead.` 
                };
            }
            
            // Check for mapping values error (common YAML mistake)
            if (line.match(/^\s*-\s*\w+:\s*$/)) {
                return { 
                    valid: false, 
                    error: `Line ${i + 1}: Mapping values are not allowed in this context. Add a space after the dash or indent the key-value pair.` 
                };
            }
            
            // Check for common docker-compose requirement
            if (i === 0 && !content.includes('services:')) {
                return { 
                    valid: false, 
                    error: 'Docker Compose file must contain a "services:" section' 
                };
            }
        }
        
        return { valid: true };
    }

    // Parse size strings (e.g., "1.5 GB") to bytes for sorting
    function parseSize(size) {
        const units = { 'B': 1, 'KB': 1024, 'MB': 1024*1024, 'GB': 1024*1024*1024 };
        const match = size.match(/(\d+\.?\d*)\s*(\w+)/);
        if (match) {
            return parseFloat(match[1]) * (units[match[2]] || 1);
        }
        return 0;
    }

    // Optimized time parsing
    function parseTime(time) {
        const units = {
            'second': 1, 'seconds': 1,
            'minute': 60, 'minutes': 60,
            'hour': 3600, 'hours': 3600,
            'day': 86400, 'days': 86400,
            'week': 604800, 'weeks': 604800,
            'month': 2592000, 'months': 2592000
        };
        
        if (time === 'Stopped' || time === 'N/A') return 0;
        
        // Single regex to capture all time parts
        const matches = time.matchAll(/(\d+)\s*(\w+)/g);
        let total = 0;
        
        for (const match of matches) {
            total += parseInt(match[1]) * (units[match[2]] || 1);
        }
        
        return total;
    }

    // Export public interface
    window.DockerManager.utils = {
        // Core utilities
        executeCommand: executeCommand,
        executeCommandStreaming: executeCommandStreaming,
        getElement: getElement,
        showNotification: showNotification,
        hideProgressNotification: hideProgressNotification,
        escapeHtml: escapeHtml,
        parseDockerError: parseDockerError,
        parseDockerComposeProgress: parseDockerComposeProgress,
        formatDate: formatDate,
        getDockerComposeCommand: getDockerComposeCommand,
        runDockerCompose: runDockerCompose,
        runDockerComposeStreaming: runDockerComposeStreaming,
        parseSize: parseSize,
        parseTime: parseTime,
        validateYamlContent: validateYamlContent,
        
        // Enhanced utilities
        dom: dom,
        validators: validators,
        dockerCommands: dockerCommands,
        errorHandler: errorHandler,
        batchOperations: batchOperations
    };

})();

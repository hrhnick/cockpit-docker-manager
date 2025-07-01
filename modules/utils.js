// Docker Manager - Utility Functions Module (Enhanced)
(function() {
    'use strict';

    // Initialize namespace if needed
    window.DockerManager = window.DockerManager || {};
    
    // Core utility functions
    function executeCommand(command, options) {
        options = options || {};
        return cockpit.spawn(command, options)
            .then(function(result) {
                return { success: true, data: result };
            })
            .catch(function(error) {
                return { success: false, error: error.message || error.toString() };
            });
    }

    function getElement(id) {
        return document.getElementById(id);
    }

    function showNotification(message, type) {
        type = type || 'info';
        const banner = getElement('action-banner');
        if (banner) {
            banner.textContent = message;
            banner.className = type;
            banner.style.display = 'block';
            setTimeout(function() {
                banner.style.display = 'none';
            }, 4000);
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Modern DOM manipulation utilities
    const dom = {
        // Enhanced element creation with template support
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

        // Template literal HTML creation
        html: function(strings, ...values) {
            const html = strings.reduce((result, str, i) => {
                const value = values[i - 1];
                if (value === undefined) return result + str;
                
                // Auto-escape values unless they're marked as safe
                const escaped = value && value.__safe ? value.toString() : escapeHtml(value);
                return result + escaped + str;
            });
            
            return { __safe: true, toString: () => html };
        },

        // Safe HTML marker
        safe: function(html) {
            return { __safe: true, toString: () => html };
        },

        // Create element from HTML string
        fromHTML: function(html) {
            const template = document.createElement('template');
            template.innerHTML = html.trim();
            return template.content.firstChild;
        },

        // Batch DOM updates
        batch: function(updates) {
            requestAnimationFrame(() => {
                updates.forEach(update => update());
            });
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

        // Query utilities with caching
        query: function(selector, parent) {
            return (parent || document).querySelector(selector);
        },

        queryAll: function(selector, parent) {
            return Array.from((parent || document).querySelectorAll(selector));
        },

        // Delegated event handling
        delegate: function(parent, eventType, selector, handler) {
            if (typeof parent === 'string') parent = getElement(parent);
            
            parent.addEventListener(eventType, function(e) {
                const target = e.target.closest(selector);
                if (target && parent.contains(target)) {
                    handler.call(target, e, target);
                }
            });
        }
    };

    // Unified validation system (unchanged)
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
        },

        subnet: function(value) {
            if (!value) return null;
            if (!/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(value)) {
                return 'Invalid subnet format. Use CIDR notation (e.g., 172.20.0.0/16)';
            }
            return null;
        },

        ipAddress: function(value) {
            if (!value) return null;
            if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
                return 'Invalid IP address format (e.g., 172.20.0.1)';
            }
            return null;
        }
    };

    // Docker command builders (unchanged)
    const dockerCommands = {
        compose: function(stack, action, options) {
            const baseCmd = this._getComposeCommand();
            const workDir = window.DockerManager.app.stacksPath + '/' + stack;
            const args = [].concat(action, options || []);
            return {
                command: ['sh', '-c', 'cd "' + workDir + '" && ' + baseCmd + ' ' + args.join(' ')],
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

        _getComposeCommand: function() {
            // Cache the result
            if (this._composeCmd) return this._composeCmd;
            
            return executeCommand(['which', 'docker-compose'], { suppressError: true })
                .then(function(result) {
                    dockerCommands._composeCmd = result.success ? 'docker-compose' : 'docker compose';
                    return dockerCommands._composeCmd;
                });
        }
    };

    // Unified error handling (unchanged)
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

    // Batch operations framework with modern patterns
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

    // Parse Docker error messages for more helpful feedback
    function parseDockerError(error) {
        if (!error) return 'Unknown error';
        
        // Common Docker error patterns
        const errorPatterns = [
            // Port conflicts
            { pattern: /bind.*address already in use/, extract: /bind: (.+)$/, message: 'Port conflict: ' },
            { pattern: /port is already allocated/, extract: /port (\d+)/, message: 'Port already in use: ' },
            
            // Network errors
            { pattern: /failed to set up container networking/, message: 'Network configuration error: ' },
            { pattern: /driver failed programming external connectivity/, message: 'Network connectivity error: ' },
            { pattern: /no such host/, message: 'DNS resolution failed - check network connection' },
            { pattern: /timeout/, message: 'Operation timed out - check network connection' },
            
            // Image errors
            { pattern: /pull access denied/, message: 'Cannot pull image - access denied or not found' },
            { pattern: /image not found/, message: 'Docker image not found' },
            { pattern: /manifest.*not found/, message: 'Image not found in registry' },
            { pattern: /unauthorized/, message: 'Authentication required - image may be private' },
            { pattern: /toomanyrequests/, message: 'Rate limit exceeded - too many pull requests' },
            
            // Volume/Mount errors
            { pattern: /invalid mount config/, message: 'Invalid volume mount configuration' },
            { pattern: /no such file or directory/, extract: /no such file or directory.*"(.+)"/, message: 'Path not found: ' },
            
            // Resource errors
            { pattern: /no space left on device/, message: 'No disk space available' },
            { pattern: /cannot allocate memory/, message: 'Insufficient memory' },
            
            // Permission errors
            { pattern: /permission denied/, message: 'Permission denied' },
            { pattern: /operation not permitted/, message: 'Operation not permitted' },
            
            // Compose file errors
            { pattern: /no configuration file/, message: 'No docker-compose.yaml file found' },
            { pattern: /yaml:.*line \d+/, extract: /(yaml:.+)/, message: 'YAML syntax error: ' },
            
            // Service errors
            { pattern: /no such service/, extract: /no such service: (.+)/, message: 'Service not found: ' },
            { pattern: /services must be a mapping/, message: 'Invalid services configuration' },
            
            // System errors
            { pattern: /Unit .* not found/, message: 'Docker service not installed' },
            { pattern: /Failed to .* Unit/, message: 'Systemd service error' }
        ];
        
        // Try to match against known patterns
        for (let i = 0; i < errorPatterns.length; i++) {
            const pattern = errorPatterns[i];
            if (pattern.pattern.test(error)) {
                if (pattern.extract) {
                    const match = error.match(pattern.extract);
                    if (match && match[1]) {
                        return pattern.message + match[1];
                    }
                }
                return pattern.message + (pattern.extract ? error : '');
            }
        }
        
        // Extract "Error response from daemon:" messages
        const daemonMatch = error.match(/Error response from daemon: (.+)/);
        if (daemonMatch) {
            return daemonMatch[1];
        }
        
        // Look for ERROR: prefixed messages
        const errorMatch = error.match(/ERROR:\s*(.+)/);
        if (errorMatch) {
            return errorMatch[1];
        }
        
        // If no pattern matched, try to extract the most relevant line
        const lines = error.split('\n').filter(function(line) {
            return line.trim() && !line.includes('docker compose') && !line.includes('docker-compose');
        });
        
        // Look for lines with error indicators
        const errorLine = lines.find(function(line) {
            return line.toLowerCase().includes('error') || 
                   line.toLowerCase().includes('failed') ||
                   line.toLowerCase().includes('cannot');
        });
        
        return errorLine || lines[0] || error.split('\n')[0];
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
        // Check if we should use 'docker-compose' or 'docker compose'
        return executeCommand(['which', 'docker-compose'], { suppressError: true })
            .then(function(result) {
                if (result.success) {
                    return ['docker-compose'];  // v1 found
                } else {
                    return ['docker', 'compose'];  // Fall back to v2
                }
            });
    }

    function runDockerCompose(stackName, args, options) {
        options = options || {};
        const app = window.DockerManager.app;
        const workDir = app.stacksPath + '/' + stackName;
        
        return getDockerComposeCommand()
            .then(function(baseCommand) {
                // Change to stack directory and run command
                const fullCommand = ['sh', '-c', 'cd "' + workDir + '" && ' + baseCommand.join(' ') + ' ' + args.join(' ')];
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

    // YAML syntax highlighting functions with modern DOM
    function applyYamlHighlighting(textareaId) {
        const textarea = getElement(textareaId);
        if (!textarea) return;
        
        // Don't apply highlighting if textarea is empty or only has placeholder
        if (!textarea.value.trim()) {
            // Set up listener to apply highlighting when user starts typing
            const inputHandler = function() {
                if (textarea.value.trim()) {
                    // Remove this listener
                    textarea.removeEventListener('input', inputHandler);
                    // Apply highlighting
                    applyYamlHighlighting(textareaId);
                }
            };
            textarea.addEventListener('input', inputHandler);
            return;
        }
        
        // Create wrapper with proper structure
        let wrapper = textarea.parentNode;
        if (!wrapper.classList.contains('yaml-editor-wrapper')) {
            wrapper = dom.create('div', { className: 'yaml-editor-wrapper' });
            textarea.parentNode.insertBefore(wrapper, textarea);
            wrapper.appendChild(textarea);
        }
        
        // Create highlighter if it doesn't exist
        const highlighterId = textareaId + '-highlighter';
        let highlighter = getElement(highlighterId);
        
        if (!highlighter) {
            highlighter = dom.create('pre', {
                id: highlighterId,
                className: 'yaml-highlighter'
            });
            wrapper.insertBefore(highlighter, textarea);
            
            // Sync scroll
            textarea.addEventListener('scroll', function() {
                highlighter.scrollTop = textarea.scrollTop;
                highlighter.scrollLeft = textarea.scrollLeft;
            });
            
            // Update on input
            textarea.addEventListener('input', function() {
                updateYamlHighlighting(textareaId);
            });
        }
        
        updateYamlHighlighting(textareaId);
    }
    
    function updateYamlHighlighting(textareaId) {
        const textarea = getElement(textareaId);
        const highlighter = getElement(textareaId + '-highlighter');
        if (!textarea || !highlighter) return;
        
        const text = textarea.value;
        const highlighted = highlightYaml(text);
        
        highlighter.innerHTML = highlighted + '\n';
        
        // Sync dimensions
        highlighter.style.width = textarea.offsetWidth + 'px';
        highlighter.style.height = textarea.offsetHeight + 'px';
    }
    
    function highlightYaml(text) {
        // Apply syntax markers first (before HTML escaping)
        // Use unique markers that won't conflict with YAML content
        text = text.replace(/(#.*$)/gm, '\x01COMMENT\x02$1\x03');
        text = text.replace(/^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*):(?=\s|$)/gm, '$1\x01KEY\x02$2\x03:');
        text = text.replace(/(["'])([^"']*)\1/g, '\x01STRING\x02$1$2$1\x03');
        text = text.replace(/\b(\d+\.?\d*)\b/g, '\x01NUMBER\x02$1\x03');
        text = text.replace(/\b(true|false|null|yes|no|on|off)\b/gi, '\x01BOOLEAN\x02$1\x03');
        text = text.replace(/^(\s*)-\s/gm, '$1\x01LIST\x02-\x03 ');
        text = text.replace(/\b(image|ports|volumes|environment|restart|depends_on|networks|build|command|expose|container_name|hostname|labels|deploy|replicas|resources|limits|reservations)\b/g, '\x01KEYWORD\x02$1\x03');
        
        // Now escape HTML
        const div = document.createElement('div');
        div.textContent = text;
        text = div.innerHTML;
        
        // Replace markers with proper HTML spans
        text = text.replace(/\x01COMMENT\x02(.*?)\x03/g, '<span class="yaml-comment">$1</span>');
        text = text.replace(/\x01KEY\x02(.*?)\x03/g, '<span class="yaml-key">$1</span>');
        text = text.replace(/\x01STRING\x02(.*?)\x03/g, '<span class="yaml-string">$1</span>');
        text = text.replace(/\x01NUMBER\x02(.*?)\x03/g, '<span class="yaml-number">$1</span>');
        text = text.replace(/\x01BOOLEAN\x02(.*?)\x03/g, '<span class="yaml-boolean">$1</span>');
        text = text.replace(/\x01LIST\x02(.*?)\x03/g, '<span class="yaml-list">$1</span>');
        text = text.replace(/\x01KEYWORD\x02(.*?)\x03/g, '<span class="yaml-docker-keyword">$1</span>');
        
        return text;
    }

    function removeYamlHighlighting(textareaId) {
        const textarea = getElement(textareaId);
        const wrapper = textarea ? textarea.parentNode : null;
        
        // Remove highlighter
        const highlighter = getElement(textareaId + '-highlighter');
        if (highlighter) {
            highlighter.remove();
        }
        
        // Unwrap if wrapped
        if (wrapper && wrapper.classList.contains('yaml-editor-wrapper')) {
            const parent = wrapper.parentNode;
            parent.insertBefore(textarea, wrapper);
            wrapper.remove();
        }
        
        // Reset textarea styles
        if (textarea) {
            textarea.style.backgroundColor = '';
            textarea.style.color = '';
            textarea.style.position = '';
            textarea.style.zIndex = '';
            textarea.style.caretColor = '';
        }
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

    // Parse time strings to seconds for sorting
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
        
        let total = 0;
        const parts = time.match(/(\d+)\s*(\w+)/g);
        if (parts) {
            parts.forEach(function(part) {
                const match = part.match(/(\d+)\s*(\w+)/);
                if (match) {
                    total += parseInt(match[1]) * (units[match[2]] || 1);
                }
            });
        }
        return total;
    }

    // Export public interface
    window.DockerManager.utils = {
        // Core utilities
        executeCommand: executeCommand,
        getElement: getElement,
        showNotification: showNotification,
        escapeHtml: escapeHtml,
        parseDockerError: parseDockerError,
        formatDate: formatDate,
        getDockerComposeCommand: getDockerComposeCommand,
        runDockerCompose: runDockerCompose,
        parseSize: parseSize,
        parseTime: parseTime,
        
        // YAML highlighting
        applyYamlHighlighting: applyYamlHighlighting,
        updateYamlHighlighting: updateYamlHighlighting,
        highlightYaml: highlightYaml,
        removeYamlHighlighting: removeYamlHighlighting,
        
        // Enhanced utilities (Priority 3 & 4)
        dom: dom,
        validators: validators,
        dockerCommands: dockerCommands,
        errorHandler: errorHandler,
        batchOperations: batchOperations
    };

})();

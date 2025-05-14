// State management
let isAnalyzing = false;
let isAnalysisInProgress = false;
let currentAnalysisId = null;
let analysisController = null;
let drawer = null;
let analysisStartTime = null;
let analysisTimeoutId = null;
let isCreatingDrawer = false; // Track if drawer creation is in progress

// Constants
const ANALYSIS_TIMEOUT_MS = 45000; // 45 seconds

// Reset the analysis state
function resetAnalysisState() {
  console.log('[Content Script] Resetting analysis state');
  
  // Store previous state for debugging
  const prevState = {
    isAnalyzing,
    isAnalysisInProgress,
    currentAnalysisId,
    hasController: !!analysisController,
    startTime: analysisStartTime
  };
  
  // Clear any existing timeouts
  if (analysisTimeoutId) {
    clearTimeout(analysisTimeoutId);
    analysisTimeoutId = null;
  }
  
  // Reset state variables
  isAnalyzing = false;
  isAnalysisInProgress = false;
  const oldAnalysisId = currentAnalysisId;
  currentAnalysisId = null;
  analysisStartTime = null;
  
  // Abort any ongoing fetch requests
  if (analysisController) {
    console.log(`[Content Script] Aborting ongoing analysis (ID: ${oldAnalysisId || 'none'})`);
    try {
      analysisController.abort();
      console.log('[Content Script] Analysis aborted successfully');
    } catch (err) {
      console.error('[Content Script] Error aborting analysis:', err);
    } finally {
      analysisController = null;
    }
  }
  
  // Notify drawer of state reset
  if (drawer?.contentWindow) {
    drawer.contentWindow.postMessage({
      type: 'ANALYSIS_STATE_RESET',
      timestamp: Date.now()
    }, '*');
  }
  
  console.log('[Content Script] Analysis state reset complete', { prevState });
}

// Helper function to ensure consistent analysis ID format
function generateAnalysisId() {
  return Date.now(); // Always return a number
}

async function createDrawer() {
  if (drawer) return;
  
  // Prevent multiple simultaneous creations
  if (isCreatingDrawer) {
    console.log('[Content Script] Drawer creation already in progress');
    return new Promise(resolve => {
      const checkDrawer = () => {
        if (drawer) {
          resolve(drawer);
        } else {
          setTimeout(checkDrawer, 100);
        }
      };
      checkDrawer();
    });
  }
  
  isCreatingDrawer = true;
  
  try {
    console.log('[Content Script] Creating drawer...');
    
    // Check if extension context is still valid
    try {
      // This will throw if extension context is invalid
      chrome.runtime.getURL('');
    } catch (e) {
      throw new Error('Extension context invalidated');
    }
    
    // Create iframe for the drawer
    const iframe = document.createElement('iframe');
    iframe.id = 'commentpulse-drawer';
    iframe.style.cssText = `
      position: fixed;
      top: 0;
      right: -400px; /* Start off-screen */
      width: 400px;
      height: 100%;
      border: none;
      z-index: 10000;
      transition: right 0.3s ease;
      box-shadow: -2px 0 10px rgba(0, 0, 0, 0.2);
      background: white;
    `;
    
    // Set the source to the drawer HTML file
    const drawerUrl = chrome.runtime.getURL('drawer.html');
    console.log('Setting drawer src to:', drawerUrl);
    iframe.src = drawerUrl;
    
    // Add the iframe to the page
    document.body.appendChild(iframe);
    drawer = iframe;
    
    // Wait for drawer to load
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Drawer initialization timeout'));
      }, 5000); // 5 second timeout
      
      iframe.onload = () => {
        clearTimeout(timeoutId);
        resolve();
      };
      
      iframe.onerror = (error) => {
        clearTimeout(timeoutId);
        reject(new Error('Failed to load drawer: ' + error));
      };
    });
    
    console.log('Drawer created and loaded successfully');
    return drawer;
  } catch (error) {
    console.error('Error creating drawer:', error);
    
    // Clean up if there was an error
    if (drawer && drawer.parentNode) {
      document.body.removeChild(drawer);
    }
    drawer = null;
    
    // Handle extension context invalidation
    if (error.message.includes('Extension context') || 
        error.message.includes('context invalidated')) {
      console.warn('Extension context invalidated, page reload required');
      // Show a user-visible message
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: #ffebee;
        border: 1px solid #ef9a9a;
        padding: 10px;
        border-radius: 4px;
        z-index: 10001;
        max-width: 300px;
      `;
      errorDiv.textContent = 'CommentPulse needs to reload the page to continue. Please wait...';
      document.body.appendChild(errorDiv);
      
      // Reload after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } else {
      // For other errors, show a retry button
      alert('Error initializing CommentPulse. Please try again.');
    }
    
    throw error;
  } finally {
    isCreatingDrawer = false;
  }
}

async function toggleDrawer() {
  try {
    // First check if we have the extension context
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      throw new Error('Extension context not available. Please refresh the page.');
    }
    
    if (!drawer) {
      try {
        await createDrawer();
      } catch (error) {
        console.error('Failed to create drawer:', error);
        throw error;
      }
    }
    
    const isOpen = drawer.style.right === '0px';
    logAnalysisState('toggleDrawer start');
    
    try {
      // Always check the analysis state when toggling the drawer
      if (isAnalysisInProgress) {
        const analysisDuration = analysisStartTime ? Date.now() - analysisStartTime : 0;
        console.warn(`Analysis state - in progress: ${isAnalysisInProgress}, duration: ${analysisDuration}ms`);
        
        // If it's been more than 10 seconds since analysis started, reset the state
        if (analysisDuration > 10000) {
          console.warn('Resetting potentially stuck analysis state');
          resetAnalysisState();
        } else {
          // If analysis just started, show a more informative message
          alert('Analysis is currently in progress. Please wait a moment...');
          return;
        }
      }
      
      // Start a new analysis
      console.log('Resetting analysis state before starting new analysis');
      resetAnalysisState(); // Ensure clean state
      
      // Set new analysis state
      const now = Date.now();
      currentAnalysisId = now;
      analysisStartTime = now;
      isAnalysisInProgress = true;
      
      console.log(`Starting new analysis with ID: ${currentAnalysisId}`);
      logAnalysisState('Starting new analysis');
      
      // Show the drawer
      drawer.style.right = '0px';
      
      // Wait for drawer to be ready
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Drawer not responding'));
        }, 2000); // 2 second timeout
        
        const checkDrawer = () => {
          if (drawer?.contentWindow) {
            clearTimeout(timeoutId);
            resolve();
          } else {
            setTimeout(checkDrawer, 100);
          }
        };
        
        checkDrawer();
      });
      
      // Notify the drawer that analysis is ready to start
      if (drawer?.contentWindow) {
        const message = {
          type: 'ANALYSIS_READY',
          timestamp: now,
          requestId: currentAnalysisId,
          startTime: analysisStartTime
        };
        console.log('Sending ANALYSIS_READY message:', message);
        drawer.contentWindow.postMessage(message, '*');
        
        // Set a timeout to reset the state if no response is received
        analysisTimeoutId = setTimeout(() => {
          if (isAnalysisInProgress) {
            const duration = Date.now() - analysisStartTime;
            console.warn(`[Content Script] Analysis timed out after ${duration}ms`);
            
            // Notify the parent frame about the timeout
            if (window.parent) {
              window.parent.postMessage({
                type: 'ANALYSIS_TIMED_OUT',
                requestId: currentAnalysisId,
                timestamp: Date.now(),
                duration: duration
              }, '*');
            }
            
            resetAnalysisState();
            alert('Analysis timed out. The server took too long to respond. Please try again.');
          }
        }, 120000); // 2 minutes timeout
      }
    } catch (error) {
      console.error('Error in toggleDrawer:', error);
      logAnalysisState('Error occurred, state reset');
      
      // Reset state on error
      resetAnalysisState();
      
      // Handle specific error cases
      let errorMessage = 'Error starting analysis. Please try again.';
      
      if (error instanceof Error) {
        if (error.message.includes('Extension context')) {
          console.log('Extension context invalidated, reloading extension...');
          window.location.reload();
          return;
        }
        errorMessage = error.message;
      }
      
      alert(errorMessage);
      throw error; // Re-throw the error for further handling if needed
    }
  } catch (error) {
    console.error('Error in toggleDrawer:', error);
    
    // Handle specific error cases
    let errorMessage = 'An error occurred. Please try again.';
    
    if (error instanceof Error) {
      if (error.message.includes('Extension context')) {
        console.log('Extension context invalidated, reloading page...');
        window.location.reload();
        return;
      }
      errorMessage = error.message;
    }
    
    alert(errorMessage);
  }
}

function closeDrawer() {
  if (!drawer) return;
  
  console.log('[Content] Closing drawer...');
  
  // Close the drawer first for better UX
  drawer.style.right = '-400px';
  
  // Then clean up resources after a short delay
  setTimeout(() => {
    cleanupResources();
    // Notify the drawer to clean up its resources
    if (drawer.contentWindow) {
      drawer.contentWindow.postMessage({ type: 'CLEANUP_RESOURCES' }, '*');
    }
  }, 300); // Small delay to allow drawer to close smoothly
}

async function cleanupResources() {
  console.log('[Content Script] Cleaning up resources');
  
  // Reset analysis state
  resetAnalysisState();
  
  try {
    // Send cleanup request to the backend
    const videoId = getVideoId();
    if (videoId) {
      try {
        const response = await fetch(`http://localhost:8000/cleanup/${videoId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Cleanup result:', result);
      } catch (error) {
        console.error('Error cleaning up analysis folder:', error);
      }
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
  
  // Clean up any blob URLs
  if (window.URL) {
    const images = document.querySelectorAll('.visualization-container img, #visualizations img');
    images.forEach(img => {
      if (img.src && img.src.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(img.src);
          console.log('Revoked blob URL:', img.src);
        } catch (e) {
          console.error('Error revoking blob URL:', e);
        }
      }
    });
  }
  
  // Clear the visualizations container in the drawer
  if (drawer && drawer.contentDocument) {
    const container = drawer.contentDocument.getElementById('visualizations');
    if (container) {
      container.innerHTML = '';
    }
  }
  
  console.log('[Content Script] Cleanup complete');
}

function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Debug function to log analysis state
function logAnalysisState(context) {
  const now = Date.now();
  let duration = 'N/A';
  
  if (analysisStartTime) {
    duration = `${now - analysisStartTime}ms`;
  }
  
  console.log(`[Analysis State] ${context} - isAnalysisInProgress: ${isAnalysisInProgress}, currentAnalysisId: ${currentAnalysisId}, time since start: ${duration}, startTime: ${analysisStartTime}`);
}

// Listen for messages from both the page and the extension
async function handleMessage(data, source) {
  try {
    console.log('[Content Script] Processing message:', data, 'from:', source);
    
    if (!data || typeof data !== 'object') {
      console.log('[Content Script] Ignoring invalid message format');
      return;
    }
    
    // Handle reset state messages
    if (data.type === 'RESET_ANALYSIS_STATE' || data.type === 'RESET_ANALYSIS_STATE_FORCE') {
      const isForce = data.type === 'RESET_ANALYSIS_STATE_FORCE';
      console.log(`[Content Script] ${isForce ? 'Force ' : ''}Reset request received`, {
        timestamp: data.timestamp,
        currentState: {
          isAnalyzing,
          isAnalysisInProgress,
          currentAnalysisId,
          hasController: !!analysisController
        }
      });
      
      // Always reset the state when receiving a reset message
      resetAnalysisState();
      
      // If it's a force reset, ensure all state is cleared
      if (isForce) {
        console.log('[Content Script] Performing force reset');
        // Clear any stored state in localStorage if needed
        try {
          localStorage.removeItem('analysisState');
        } catch (e) {
          console.warn('Could not clear localStorage:', e);
        }
      }
      
      // Acknowledge the reset
      const ackTimestamp = data.timestamp || Date.now();
      console.log(`[Content Script] Sending reset acknowledgment for timestamp: ${ackTimestamp}`);
      
      if (drawer?.contentWindow) {
        try {
          drawer.contentWindow.postMessage({
            type: 'ANALYSIS_STATE_RESET',
            timestamp: ackTimestamp,
            source: 'content_script',
            requestId: data.requestId
          }, '*');
          console.log('[Content Script] Reset acknowledgment sent');
        } catch (err) {
          console.error('[Content Script] Error sending reset acknowledgment:', err);
        }
      } else {
        console.warn('[Content Script] Could not send reset acknowledgment - drawer not ready');
      }
      return;
    }
    
    const { type, timestamp, requestId } = data;
    console.log(`[Content Script] Processing message type: ${type}, requestId: ${requestId}`);
    
    // Handle messages from the page (drawer)
    if (source === 'page' && type === 'ANALYZE_COMMENTS') {
      console.log('[Content Script] ANALYZE_COMMENTS received from page');
      // Generate a new request ID for this analysis
      const requestId = generateAnalysisId();
      console.log(`[Content Script] Starting new analysis with requestId: analysis_${requestId}`);
      
      // Prepare analysis data with the new request ID
      const analysisData = {
        ...data,
        requestId: `analysis_${requestId}`,
        timestamp: requestId
      };
      
      // Update current analysis state
      currentAnalysisId = requestId;
      isAnalysisInProgress = true;
      
      // Clear any existing analysis state
      if (isAnalysisInProgress) {
        console.log('[Content Script] Cancelling previous analysis');
        isAnalysisInProgress = false;
        currentAnalysisId = null;
      }
      
      // Start the new analysis
      await handleAnalyzeRequest(analysisData);
    }
    
    // Handle messages from the extension (background/popup)
    if (source === 'extension' && type === 'ANALYZE_COMMENTS') {
      console.log('[Content Script] ANALYZE_COMMENTS received from extension');
      await handleAnalyzeRequest({
        ...data,
        requestId: data.requestId || `ext_${Date.now()}`
      });
    }
  } catch (error) {
    console.error('[Content Script] Error in message handler:', error);
  }
}

// Function to check server health
async function checkServerHealth(apiEndpoint) {
  const healthController = new AbortController();
  const healthTimeout = setTimeout(() => healthController.abort(), 5000);
  
  const healthUrl = `${apiEndpoint}/health`;
  console.log('[Health Check] Requesting:', healthUrl);
  
  try {
    const testResponse = await fetch(healthUrl, {
      method: 'GET',
      signal: healthController.signal,
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    clearTimeout(healthTimeout);
    
    console.log('[Health Check] Response status:', testResponse.status, testResponse.statusText);
    
    if (!testResponse.ok) {
      const errorText = await testResponse.text().catch(() => 'No details');
      console.error('[Health Check] Error response:', errorText);
      throw new Error(`Server returned status: ${testResponse.status} - ${testResponse.statusText}\n${errorText}`);
    }
    
    console.log('[Health Check] Server is healthy');
    return true;
  } catch (fetchError) {
    clearTimeout(healthTimeout);
    if (fetchError.name === 'AbortError') {
      throw new Error('Server connection timed out. Please check if the server is running and accessible.');
    } else if (fetchError.message.includes('Failed to fetch')) {
      throw new Error(`Could not connect to the server at ${apiEndpoint}. Make sure the server is running.`);
    } else {
      throw new Error(`Connection failed: ${fetchError.message}`);
    }
  }
}

// Handle analyze request
async function handleAnalyzeRequest({ requestId, timestamp }) {
  console.log('[Content Script] Handling analyze request, requestId:', requestId);
  logAnalysisState('handleAnalyzeRequest start');
  
  // Set the current analysis ID
  currentAnalysisId = requestId;
  isAnalysisInProgress = true;
  
  console.log(`[Content Script] Starting analysis ${requestId} at ${new Date(timestamp).toISOString()}`);
  
  try {
    const videoId = getVideoId();
    if (!videoId) {
      throw new Error('No video ID found');
    }

    // Show loading state in drawer
    if (drawer && drawer.contentWindow) {
      const startMessage = {
        type: 'ANALYSIS_STARTED',
        timestamp: timestamp
      };
      console.log('[Content Script] Sending ANALYSIS_STARTED:', startMessage);
      drawer.contentWindow.postMessage(startMessage, '*');
    }

    // Hardcoded settings
    const apiEndpoint = 'http://localhost:8000';
    const maxComments = 1000;
    const daysBack = 7;
    
    // Skip initial health check and go straight to analysis
    // This saves a round-trip to the server
    if (drawer?.contentWindow) {
      drawer.contentWindow.postMessage({
        type: 'ANALYSIS_PROGRESS',
        data: { message: 'Starting analysis...' }
      }, '*');
    }
    
    // Make the analysis request with optimized settings
    const analysisUrl = `${apiEndpoint}/analyze`;
    const requestPayload = {
      video_id: videoId,
      days_back: daysBack,
      max_comments: maxComments
    };
    
    console.log('[Analysis] Sending request to:', analysisUrl);
    
    // Create a controller with a 30-second timeout
    const controller = new AbortController();
    analysisController = controller;
    const analysisTimeout = setTimeout(() => {
      console.warn(`[Analysis] Request timed out after 30s`);
      controller.abort();
    }, 30000);
    
    try {
      const startTime = performance.now();
      
      // Optimized fetch configuration
      const response = await fetch(analysisUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'your-api-key-here',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Connection': 'keep-alive',
          'Keep-Alive': 'timeout=30, max=1'
        },
        body: JSON.stringify(requestPayload),
        referrerPolicy: 'no-referrer',
        mode: 'cors',
        credentials: 'same-origin'
      });
      
      const endTime = performance.now();
      clearTimeout(analysisTimeout);
      analysisController = null; // Clear the controller since request completed
      
      console.log(`[Analysis] Response received in ${(endTime - startTime).toFixed(2)}ms`);
      console.log('[Analysis] Response status:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Analysis] Error response:', {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: errorText
        });
        throw new Error(`HTTP error! status: ${response.status}, ${errorText}`);
      }
      
      const responseData = await response.json();
      
      // Send results back to drawer
      if (drawer && drawer.contentWindow) {
        const resultsMessage = {
          type: 'ANALYSIS_RESULTS',
          data: responseData,
          timestamp: timestamp
        };
        console.log('Sending ANALYSIS_RESULTS message:', resultsMessage);
        drawer.contentWindow.postMessage(resultsMessage, '*');
      }
      
      // Log successful completion
      console.log('Analysis completed successfully');
      logAnalysisState('After successful analysis');
      
      return responseData;
    } catch (error) {
      clearTimeout(analysisTimeout);
      analysisController = null;
      
      const errorMessage = error.name === 'AbortError' 
        ? 'Analysis timed out. The server took too long to respond.'
        : error.message;
      
      console.error('[Analysis] Error:', { 
        name: error.name,
        message: error.message,
        stack: error.stack,
        isAborted: error.name === 'AbortError'
      });
      
      // Send error to drawer if this is still the current analysis
      if (requestId === currentAnalysisId && drawer?.contentWindow) {
        console.log(`[Analysis] Sending error to drawer for request ${requestId}`);
        drawer.contentWindow.postMessage({
          type: 'ANALYSIS_ERROR',
          error: errorMessage,
          requestId,
          timestamp: Date.now(),
          isTimeout: error.name === 'AbortError'
        }, '*');
      }
      
      // Reset state on timeout
      if (error.name === 'AbortError') {
        resetAnalysisState();
      }
      
      throw error;
    }
  } catch (error) {
    console.error(`[Content Script] Error in analyze request ${requestId}:`, error);
    
    // Send error to drawer if this is still the current analysis
    if (requestId === currentAnalysisId && drawer && drawer.contentWindow) {
      drawer.contentWindow.postMessage({
        type: 'ANALYSIS_ERROR',
        error: error.message,
        requestId,
        timestamp: Date.now()
      }, '*');
    }
    
    throw error;
  } finally {
    // Ensure we always reset the analysis state when done
    if (timestamp === currentAnalysisId) {
      console.log('Finally block - ensuring analysis state is clean');
      isAnalysisInProgress = false;
      currentAnalysisId = null;
      logAnalysisState('After finally cleanup');
    }
  }
}

// Listen for messages from both the page and the extension
window.addEventListener('message', (event) => {
  console.log('[Content Script] Received window message:', event.data, 'from:', event.origin);
  
  // Handle close drawer message from the drawer
  if (event.data && event.data.type === 'CLOSE_DRAWER') {
    console.log('[Content] Received CLOSE_DRAWER message');
    closeDrawer();
    return;
  }
  
  // Handle timeout notifications from drawer
  if (event.data && event.data.type === 'ANALYSIS_TIMED_OUT') {
    console.log('[Content Script] Received timeout notification from drawer, resetting state');
    resetAnalysisState();
    return;
  }
  
  handleMessage(event.data, 'page');
});

// Listen for messages from the extension
if (chrome && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Content Script] Received extension message:', message, 'from:', sender);
    handleMessage(message, 'extension');
    return true; // Keep the message channel open for async response
  });
}

// Add button to YouTube interface
function addAnalyzeButton() {
  const targetElement = document.querySelector('ytd-menu-renderer #top-level-buttons-computed, ytd-menu-renderer #top-level-buttons');
  if (!targetElement || document.querySelector('#commentpulse-button')) return;

  const button = document.createElement('button');
  button.id = 'commentpulse-button';
  button.setAttribute('aria-label', 'Analyze Comments');
  button.setAttribute('title', 'Analyze Comments');
  button.role = 'button';
  button.tabIndex = '0';
  
  // Create icon element
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('width', '20');
  iconSvg.setAttribute('height', '20');
  iconSvg.style.marginRight = '8px';
  
  const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  iconPath.setAttribute('d', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 10h2v-4h-2v4zm0-6h2V6h-2v4z');
  iconPath.setAttribute('fill', 'currentColor');
  iconSvg.appendChild(iconPath);
  
  // Create text span
  const buttonText = document.createElement('span');
  buttonText.textContent = 'Analyze Comments';
  buttonText.style.display = 'flex';
  buttonText.style.alignItems = 'center';
  buttonText.style.justifyContent = 'center';
  
  // Add icon and text to button
  buttonText.prepend(iconSvg);
  button.appendChild(buttonText);
  
  // Add a subtle glow effect on hover
  const style = document.createElement('style');
  style.textContent = `
    @keyframes buttonPulse {
      0% { box-shadow: 0 0 0 0 rgba(255, 82, 82, 0.7); }
      70% { box-shadow: 0 0 0 10px rgba(255, 82, 82, 0); }
      100% { box-shadow: 0 0 0 0 rgba(255, 82, 82, 0); }
    }
    #commentpulse-button:hover {
      animation: buttonPulse 1.5s infinite;
    }
  `;
  document.head.appendChild(style);

  button.addEventListener('click', toggleDrawer);
  targetElement.appendChild(button);
}

let currentVideoId = null;
let buttonObserver = null;

function getCurrentVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

function handleVideoChange() {
  const newVideoId = getCurrentVideoId();
  if (newVideoId && newVideoId !== currentVideoId) {
    currentVideoId = newVideoId;
    // Remove existing button if it exists
    const existingButton = document.getElementById('commentpulse-button');
    if (existingButton) {
      existingButton.remove();
    }
    // Add new button
    addAnalyzeButton();
  }
}

// Watch for YouTube's dynamic content loading
function setupObservers() {
  // Clean up existing observer if any
  if (buttonObserver) {
    buttonObserver.disconnect();
  }
  
  // Watch for URL changes (video changes)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      handleVideoChange();
    }
  }, 1000);
  
  // Watch for dynamic content changes
  buttonObserver = new MutationObserver((mutations) => {
    // Check if the target element exists and our button is missing
    const targetElement = document.querySelector('ytd-menu-renderer #top-level-buttons-computed, ytd-menu-renderer #top-level-buttons');
    if (targetElement && !document.getElementById('commentpulse-button')) {
      addAnalyzeButton();
    }
  });
  
  buttonObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Initial setup
  handleVideoChange();
}

// Start the observers when the page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupObservers);
} else {
  setupObservers();
}
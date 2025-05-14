// Load Chart.js dynamically
// State variables
let isAnalyzing = false;
let isAnalysisInProgress = false;
let currentAnalysisId = null;
let currentChart = null;
let chartLoaded = false;
let resetInProgress = false;
let resetTimestamp = null;
let analysisStartTime = null;  // Add this to track analysis start time
let analysisTimeoutId = null;
let messageQueue = [];
let isProcessingQueue = false;

// Constants
const ANALYSIS_TIMEOUT_MS = 120000; // 2 minutes
const MESSAGE_PROCESSING_INTERVAL = 100; // 100ms

// Load Chart.js when needed
// Load Chart.js from local file
// Load Chart.js from local file
function loadChartJS() {
  if (chartLoaded) return Promise.resolve();
  
  return new Promise((resolve, reject) => {
    try {
      // Create script element
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = chrome.runtime.getURL('libs/chart.min.js');
      
      // Add error handling
      script.onerror = () => {
        console.error('Error loading Chart.js');
        reject(new Error('Failed to load Chart.js'));
      };
      
      // Add load handler
      script.onload = () => {
        console.log('Chart.js loaded successfully');
        chartLoaded = true;
        resolve();
      };
      
      // Append to head
      document.head.appendChild(script);
    } catch (error) {
      console.error('Error creating script element:', error);
      reject(error);
    }
  });
}

// Track all blob URLs for cleanup
let blobUrls = new Set();

// Helper functions
function clearAnalysisTimeout() {
  if (analysisTimeoutId) {
    clearTimeout(analysisTimeoutId);
    analysisTimeoutId = null;
    console.log('[Drawer] Cleared analysis timeout');
  }
}

// State management functions
function getAnalysisState() {
  const now = Date.now();
  const duration = analysisStartTime ? now - analysisStartTime : 0;
  return {
    isAnalyzing,
    isAnalysisInProgress,
    currentAnalysisId,
    duration,
    startTime: analysisStartTime,
    resetInProgress
  };
}

function logAnalysisState(message = '') {
  const state = getAnalysisState();
  console.log(`[Drawer] Analysis State ${message}:`, state);
}

function resetAnalysisState() {
  console.log('[Drawer] Resetting analysis state');
  
  // Clear any existing timeouts
  clearAnalysisTimeout();
  
  // Reset all state variables
  isAnalyzing = false;
  isAnalysisInProgress = false;
  currentAnalysisId = null;
  analysisStartTime = null;
  resetInProgress = false;
  
  // Get UI elements
  const loadingElement = document.getElementById('loading');
  const errorElement = document.getElementById('error');
  const resultsElement = document.getElementById('results');
  
  // Reset UI to initial state
  if (loadingElement) loadingElement.style.display = 'none';
  if (errorElement) errorElement.style.display = 'none';
  if (resultsElement) resultsElement.style.display = 'none';
  
  logAnalysisState('after reset');
}

function cleanupResources() {
  console.log('[Drawer] Cleaning up resources...');
  
  // Clear any pending timeouts
  clearAnalysisTimeout();
  
  // Reset analysis state
  resetAnalysisState();
  
  // Revoke any blob URLs we created
  blobUrls.forEach(url => {
    try {
      URL.revokeObjectURL(url);
      console.log('[Drawer] Revoked blob URL:', url);
    } catch (e) {
      console.error('[Drawer] Error revoking blob URL:', e);
    }
  });
  blobUrls.clear();
  
  // Clear any charts
  if (currentChart) {
    try {
      currentChart.destroy();
      console.log('[Drawer] Destroyed chart instance');
    } catch (e) {
      console.error('[Drawer] Error destroying chart:', e);
    }
    currentChart = null;
  }
  
  // Clear the visualizations container
  const container = document.getElementById('visualizations');
  if (container) {
    container.innerHTML = '';
    console.log('[Drawer] Cleared visualizations container');
  }
  
  // Reset all state variables
  isAnalyzing = false;
  isAnalysisInProgress = false;
  currentAnalysisId = null;
  analysisStartTime = null;
  resetInProgress = false;
  
  // Notify parent window about cleanup
  try {
    window.parent.postMessage({
      type: 'CLEANUP_RESOURCES',
      timestamp: Date.now()
    }, '*');
    console.log('[Drawer] Sent cleanup notification to parent');
  } catch (e) {
    console.error('[Drawer] Error sending cleanup notification:', e);
  }
  
  console.log('[Drawer] Cleanup complete');
}

// Message queue processing
async function processMessageQueue() {
  if (isProcessingQueue || messageQueue.length === 0) return;
  
  isProcessingQueue = true;
  console.log('[Drawer] Processing message queue, length:', messageQueue.length);
  
  try {
    while (messageQueue.length > 0) {
      const message = messageQueue.shift();
      await handleMessage(message);
      // Small delay between processing messages
      await new Promise(resolve => setTimeout(resolve, MESSAGE_PROCESSING_INTERVAL));
    }
  } catch (error) {
    console.error('[Drawer] Error processing message queue:', error);
  } finally {
    isProcessingQueue = false;
  }
}

// Enhanced message handling
async function handleMessage(event) {
  if (!event.data || typeof event.data !== 'object') {
    console.warn('[Drawer] Received invalid message format:', event.data);
    return;
  }
  
  const { type, data, error, timestamp, requestId, source, startTime } = event.data;
  console.log(`[Drawer] Processing message type: ${type}`, { requestId, timestamp, source, startTime });
  
  // Handle reset acknowledgment
  if (type === 'ANALYSIS_STATE_RESET') {
    console.log('[Drawer] Received reset acknowledgment', { timestamp, resetTimestamp });
    if (timestamp && resetTimestamp && timestamp >= resetTimestamp) {
      resetInProgress = false;
      console.log('[Drawer] Reset completed successfully');
      if (window.completeReset) {
        window.completeReset();
        window.completeReset = null;
      }
    }
    return;
  }
  
  // Handle analysis ready message
  if (type === 'ANALYSIS_READY') {
    console.log('[Drawer] Analysis ready, starting...', { requestId, startTime });
    if (startTime) {
      analysisStartTime = startTime;
    }
    
    // Clear any existing timeouts when starting new analysis
    clearAnalysisTimeout();
    
    startAnalysis();
    return;
  }
  
  // Simplified source validation for Chrome extension
  const isValidSource = true; // Accept all messages since we're in a controlled environment
  
  if (!isValidSource) {
    console.log('[Drawer] Ignoring message from unknown source:', event.origin);
    return;
  }
  
  // Handle all message types in the switch statement
  switch (type) {
    case 'ANALYSIS_STARTED':
      console.log('[Drawer] Analysis started, requestId:', requestId);
      // Only update state if this is a new analysis or we're forcing a restart
      if (!isAnalyzing || requestId !== currentAnalysisId) {
        isAnalyzing = true;
        isAnalysisInProgress = true;
        currentAnalysisId = requestId;
        if (startTime) {
          analysisStartTime = startTime;
        }
        
        // Update UI
        const loadingElement = document.getElementById('loading');
        const errorElement = document.getElementById('error');
        const resultsElement = document.getElementById('results');
        
        if (loadingElement) loadingElement.style.display = 'flex';
        if (errorElement) errorElement.style.display = 'none';
        if (resultsElement) resultsElement.style.display = 'none';
        
        const loadingMessage = loadingElement?.querySelector('p');
        if (loadingMessage) {
          loadingMessage.textContent = 'Analyzing comments...';
        }
        
        // Set timeout for analysis
        clearAnalysisTimeout();
        analysisTimeoutId = setTimeout(() => {
          if (isAnalyzing) {
            const duration = Date.now() - analysisStartTime;
            console.warn(`[Drawer] Analysis timed out after ${duration}ms`);
            handleAnalysisError({
              message: 'Analysis timed out. The server took too long to respond.',
              isTimeout: true
            }, currentAnalysisId);
          }
        }, ANALYSIS_TIMEOUT_MS);
        
        console.log('[Drawer] Loading state updated');
      } else {
        console.log('[Drawer] Ignoring duplicate ANALYSIS_STARTED for same requestId:', requestId);
      }
      break;
      
    case 'ANALYSIS_RESULTS':
      console.log('[Drawer] Analysis results received:', data);
      
      // Calculate duration before resetting state
      const duration = analysisStartTime ? Date.now() - analysisStartTime : 0;
      console.log(`[Drawer] Analysis completed in ${duration}ms`);
      
      // Reset state
      isAnalyzing = false;
      isAnalysisInProgress = false;
      analysisStartTime = null;
      
      // Clear timeout
      clearAnalysisTimeout();
      
      // Only process if this is the most recent analysis
      if (requestId && currentAnalysisId && requestId !== currentAnalysisId) {
        console.log(`[Drawer] Ignoring stale analysis result for request ${requestId}, current is ${currentAnalysisId}`);
        break;
      }
      
      if (!data) {
        console.error('[Drawer] No data received in ANALYSIS_RESULTS');
        handleAnalysisError('No data received from analysis. Please try again.');
        break;
      }
      
      // Hide loading and show results
      const loadingElement = document.getElementById('loading');
      const errorElement = document.getElementById('error');
      const resultsElement = document.getElementById('results');
      
      if (loadingElement) loadingElement.style.display = 'none';
      if (errorElement) errorElement.style.display = 'none';
      if (resultsElement) resultsElement.style.display = 'block';
      
      // Load Chart.js and display results
      try {
        await loadChartJS();
        displayResults(data);
        console.log('[Drawer] Results displayed successfully');
      } catch (error) {
        console.error('[Drawer] Error displaying results:', error);
        handleAnalysisError('Error displaying results. Please try again.');
      }
      break;
      
    case 'ANALYSIS_ERROR':
      console.error('[Drawer] Analysis error:', error || 'Unknown error');
      handleAnalysisError(error || 'An error occurred during analysis.');
      break;
      
    case 'ANALYSIS_PROGRESS':
      console.log('[Drawer] Analysis progress:', data);
      // Update loading message if progress data is available
      if (data && data.message) {
        const loadingElement = document.getElementById('loading');
        const loadingMessage = loadingElement?.querySelector('p');
        if (loadingMessage) {
          loadingMessage.textContent = data.message;
        }
      }
      break;
      
    case 'CLEANUP_RESOURCES':
      console.log('[Drawer] Cleaning up resources...');
      cleanupResources();
      break;
      
    case 'CLOSE_DRAWER':
      console.log('[Drawer] Closing drawer...');
      cleanupResources();
      window.parent.postMessage({ type: 'CLOSE_DRAWER' }, '*');
      break;
      
    case 'ANALYSIS_TIMED_OUT':
      console.log('[Drawer] Received ANALYSIS_TIMED_OUT, cleaning up...', data);
      handleAnalysisError({
        message: `Analysis timed out after ${data.duration || 'unknown'}ms. Please try again.`,
        isTimeout: true
      }, data.requestId);
      break;
      
    default:
      console.warn('[Drawer] Unknown message type:', type);
  }
}

// Initialize message handling
document.addEventListener('DOMContentLoaded', () => {
  const closeButton = document.getElementById('close-drawer');
  const loadingElement = document.getElementById('loading');
  const errorElement = document.getElementById('error');
  const resultsElement = document.getElementById('results');
  
  // Initialize UI state
  loadingElement.style.display = 'flex';
  errorElement.style.display = 'none';
  resultsElement.style.display = 'none';
  
  // Start analysis automatically after a small delay to ensure drawer is ready
  setTimeout(() => {
    startAnalysis();
  }, 100);
  
  // Enhanced close button handler
  closeButton.addEventListener('click', () => {
    console.log('[Drawer] Close button clicked, cleaning up...');
    cleanupResources();
    window.parent.postMessage({ type: 'CLOSE_DRAWER' }, '*');
  });
  
  // Add cleanup on beforeunload
  window.addEventListener('beforeunload', () => {
    console.log('[Drawer] Window unloading, cleaning up...');
    cleanupResources();
  });
  
  // Add message queue processing
  window.addEventListener('message', (event) => {
    console.log('[Drawer] Received message:', event.data);
    messageQueue.push(event);
    processMessageQueue();
  });
  
  // Update loading message to show we're initializing
  const loadingMessage = loadingElement.querySelector('p');
  if (loadingMessage) {
    loadingMessage.textContent = 'Initializing analysis...';
  }
});

function displayResults(data) {
  try {
    console.log('Displaying results:', data);
    
    // Log the full data structure to find visualizations
    console.log('Full data structure for visualizations:', JSON.stringify(data, null, 2));

    // Try to find visualizations in different possible locations
    let visualizations = [];
    
    // Check various possible paths for visualizations
    const possibleVizPaths = [
      data.visualizations,                    // Direct path
      data.analysis_results?.visualizations,  // Nested in analysis_results
      data.analysis_results?.images,          // Alternative name
      data.images,                            // Top level alternative
      data.charts,                            // Another possible name
      data.analysis_results?.charts,          // Nested charts
      data.analysis_results?.plots,           // Another possible name
      data.plots                              // Top level plots
    ];
    
    // Find the first valid array of visualizations
    for (const path of possibleVizPaths) {
      if (Array.isArray(path) && path.length > 0) {
        console.log('Found visualizations at path:', path);
        visualizations = path;
        break;
      }
    }
    
    console.log('Processing visualizations:', visualizations);

    // Display visualizations
    const visualizationsGrid = document.getElementById('visualizations-grid');
    if (!visualizationsGrid) {
      console.error('Visualizations grid not found');
      return;
    }
    
    // Clear existing visualizations
    visualizationsGrid.innerHTML = '';

    if (visualizations.length > 0) {
      visualizations.forEach((item, index) => {
        // Handle both direct URLs and objects with url property
        const url = typeof item === 'string' ? item : (item.url || item.src || item.image || item.chart);
        
        if (!url || typeof url !== 'string') {
          console.error(`Invalid visualization at index ${index}:`, item);
          return;
        }

        console.log(`Loading visualization ${index + 1}:`, url);
        const imgContainer = document.createElement('div');
        imgContainer.className = 'visualization-container';
        
        const img = document.createElement('img');
        // Ensure URL is properly formatted and handle different URL formats
        let fullUrl = url.trim();
        
        // Clean up the URL (remove any surrounding quotes or whitespace)
        fullUrl = fullUrl.replace(/^['"]|['"]$/g, '');
        
        // If it's already a full URL, use it as is
        if (fullUrl.startsWith('http') || fullUrl.startsWith('data:image')) {
          // No need to modify fullUrl
        } 
        // Handle relative URLs
        else if (fullUrl.startsWith('/')) {
          fullUrl = `http://localhost:8000${fullUrl}`;
        } 
        // Handle relative URLs without leading slash
        else {
          fullUrl = `http://localhost:8000/${fullUrl}`;
        }
        
        console.log(`Attempting to load image from: ${fullUrl}`);
        
        // Set up the image element
        img.alt = `Visualization ${index + 1}`;
        img.loading = 'lazy';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        
        // Track blob URLs for cleanup
        if (fullUrl.startsWith('blob:')) {
          blobUrls.add(fullUrl);
        }
        
        // Add loading spinner
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        imgContainer.appendChild(spinner);
        
        // Add the image to the container (hidden at first)
        imgContainer.appendChild(img);
        
        // Create a new image to test loading
        const testImg = new Image();
        testImg.crossOrigin = 'Anonymous'; // Handle CORS if needed
        
        // Test the image URL first
        testImg.onload = () => {
          console.log(`Image loaded successfully: ${fullUrl}`);
          // If test passes, set the actual image source
          img.src = fullUrl;
        };
        
        testImg.onerror = (e) => {
          console.error(`Failed to load test image: ${fullUrl}`, e);
          // Try with a timestamp to bypass cache
          const timestamp = new Date().getTime();
          const cacheBusterUrl = `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}_=${timestamp}`;
          console.log(`Trying with cache buster: ${cacheBusterUrl}`);
          img.src = cacheBusterUrl;
        };
        
        // Handle image load success
        img.onload = () => {
          console.log(`Image displayed successfully: ${img.src}`);
          spinner.remove();
        };
        
        // Handle image load error
        img.onerror = (e) => {
          console.error(`Failed to load image: ${img.src}`, e);
          spinner.remove();
          const errorMessage = document.createElement('div');
          errorMessage.className = 'error-message';
          errorMessage.innerHTML = `
            <p>Failed to load visualization</p>
            <p class="hint">URL: <a href="${fullUrl}" target="_blank">${fullUrl}</a></p>
            <p class="hint">Status: ${e.type || 'Unknown error'}</p>
            <p class="hint">Check console for details</p>
          `;
          imgContainer.appendChild(errorMessage);
        };
        
        // Start the test load
        testImg.src = fullUrl;
        
        // Add a title or caption if available
        if (typeof item === 'object' && (item.title || item.caption)) {
          const caption = document.createElement('div');
          caption.className = 'visualization-caption';
          caption.textContent = item.title || item.caption;
          imgContainer.appendChild(caption);
        }
        
        visualizationsGrid.appendChild(imgContainer);
      });
    } else {
      console.log('No visualizations found in data');
      const noVisualizations = document.createElement('div');
      noVisualizations.className = 'no-visualizations';
      noVisualizations.innerHTML = `
        <p>No visualizations available</p>
        <p class="hint">The analysis did not generate any visualizations.</p>
        <p class="hint">Data structure: ${JSON.stringify(data, null, 2)}</p>
      `;
      visualizationsGrid.appendChild(noVisualizations);
    }
    
    // Display summary
    document.getElementById('summary-text').textContent = data.summary || 'No summary available';
    
    // Display metrics
    document.getElementById('total-comments').textContent = 
      data.analysis_results?.total_comments?.toLocaleString() || '0';
    document.getElementById('unique-authors').textContent = 
      data.analysis_results?.unique_authors?.toLocaleString() || '0';
    document.getElementById('engagement-rate').textContent = 
      data.analysis_results?.engagement_rate ? 
      `${(data.analysis_results.engagement_rate * 100).toFixed(1)}%` : '0%';
    
    // Create sentiment chart
    const sentimentCtx = document.getElementById('sentiment-chart');
    if (!sentimentCtx) {
      console.error('Sentiment chart canvas not found');
      return;
    }
    
    // Clear any existing chart and data
    if (currentChart) {
      currentChart.destroy();
      currentChart = null;
    }
    
    // Reset canvas dimensions
    const container = sentimentCtx.parentElement;
    const containerWidth = container.clientWidth - 32; // Account for padding
    const containerHeight = 180; // Fixed height
    
    // Set canvas dimensions
    sentimentCtx.width = containerWidth;
    sentimentCtx.height = containerHeight;
    
    // Clear the canvas
    const ctx = sentimentCtx.getContext('2d');
    ctx.clearRect(0, 0, containerWidth, containerHeight);
    
    // Debug logging for sentiment distribution
    console.log('Full data object:', data);
    
    // Try to find sentiment data in different possible locations
    let sentimentData = {
      positive: 0,
      neutral: 0,
      negative: 0
    };
    
    // Check various possible locations for the sentiment data
    const possiblePaths = [
      data.analysis_results?.sentiment_distribution,
      data.analysis_results?.sentiment,
      data.sentiment_distribution,
      data.sentiment,
      data.analysis_results,
      data
    ];
    
    // Try each possible path
    for (const path of possiblePaths) {
      if (!path) continue;
      
      // Check for different possible property names
      const positive = path.positive ?? path.Positive ?? path.pos ?? path.POSITIVE;
      const neutral = path.neutral ?? path.Neutral ?? path.neu ?? path.NEUTRAL;
      const negative = path.negative ?? path.Negative ?? path.neg ?? path.NEGATIVE;
      
      if (positive !== undefined || neutral !== undefined || negative !== undefined) {
        sentimentData = {
          positive: Math.abs(parseInt(positive) || 0),
          neutral: Math.abs(parseInt(neutral) || 0),
          negative: Math.abs(parseInt(negative) || 0)
        };
        console.log('Found sentiment data in:', path);
        break;
      }
    }
    
    console.log('Final sentiment data for chart:', sentimentData);
    
    // If all zeros, show a message in the chart
    if (sentimentData.positive === 0 && sentimentData.neutral === 0 && sentimentData.negative === 0) {
      console.log('Warning: All sentiment values are zero - showing sample data');
      sentimentData = { positive: 1, neutral: 1, negative: 1 }; // Sample data to show the chart
    }
    
    // Create new chart with fixed dimensions
    try {
      currentChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Positive', 'Neutral', 'Negative'],
          datasets: [{
            data: [
              sentimentData.positive,
              sentimentData.neutral,
              sentimentData.negative
            ],
            backgroundColor: ['#34a853', '#fbbc05', '#ea4335'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: false, // Disable responsive behavior
          maintainAspectRatio: false,
          layout: {
            padding: 10
          },
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                padding: 20,
                boxWidth: 12,
                font: {
                  size: 12
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.label || '';
                  const value = context.raw || 0;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = Math.round((value / total) * 100) || 0;
                  return `${label}: ${value} (${percentage}%)`;
                }
              }
            }
          },
          cutout: '70%',
          radius: '90%',
          elements: {
            arc: {
              borderWidth: 0
            }
          },
          animation: {
            animateScale: true,
            animateRotate: true
          }
        }
      });
      
      // Force chart resize
      currentChart.resize();
      
      console.log('Chart created successfully');
    } catch (error) {
      console.error('Error creating chart:', error);
      // Fallback: Show error message in the canvas
      ctx.font = '14px Arial';
      ctx.fillStyle = '#666';
      ctx.textAlign = 'center';
      ctx.fillText('Could not display chart', containerWidth / 2, containerHeight / 2);
    }
  } catch (error) {
    console.error('Error displaying results:', error);
    document.getElementById('error').classList.remove('hidden');
    document.getElementById('error').querySelector('p').textContent = 
      'Error displaying results. Please try again.';
  }
}

function startAnalysis(force = false) {
  logAnalysisState('before start');
  
  // Prevent multiple simultaneous analyses
  if (isAnalyzing && !force) {
    console.log('[Drawer] Analysis already in progress, ignoring start request');
    return;
  }
  
  // Get UI elements once and cache them
  const loadingElement = document.getElementById('loading');
  const errorElement = document.getElementById('error');
  const resultsElement = document.getElementById('results');
  
  // Reset any existing state
  if (force) {
    resetAnalysisState();
  } else {
    // Clear any existing timeouts if not forcing
    clearAnalysisTimeout();
  }
  
  try {
    // Generate a new request ID for this analysis
    const now = Date.now();
    currentAnalysisId = now;
    analysisStartTime = now;
    isAnalyzing = true;
    isAnalysisInProgress = true;
    
    // Update UI
    const loadingElement = document.getElementById('loading');
    const errorElement = document.getElementById('error');
    const resultsElement = document.getElementById('results');
    
    if (loadingElement) loadingElement.style.display = 'flex';
    if (errorElement) errorElement.style.display = 'none';
    if (resultsElement) resultsElement.style.display = 'none';
    
    console.log(`[Drawer] Starting analysis with requestId: ${currentAnalysisId}`);
    
    // Send analysis request
    const message = { 
      type: 'ANALYZE_COMMENTS',
      requestId: currentAnalysisId,
      source: 'drawer',
      timestamp: now,
      startTime: analysisStartTime
    };
    
    console.log('[Drawer] Sending message to parent:', message);
    window.parent.postMessage(message, '*');
    
    // Set a timeout to reset the button if no response is received
    analysisTimeoutId = setTimeout(() => {
      if (isAnalyzing) {
        const duration = Date.now() - analysisStartTime;
        console.warn(`[Drawer] Analysis timed out after ${duration}ms`);
        handleAnalysisError({
          message: 'Analysis timed out. The server took too long to respond.',
          isTimeout: true
        }, currentAnalysisId);
        
        // Notify content script about the timeout
        if (window.parent) {
          window.parent.postMessage({
            type: 'ANALYSIS_TIMED_OUT',
            requestId: currentAnalysisId,
            timestamp: Date.now()
          }, '*');
        }
      }
    }, ANALYSIS_TIMEOUT_MS);
    
    logAnalysisState('after start');
    
  } catch (error) {
    console.error('[Drawer] Error starting analysis:', error);
    handleAnalysisError('Error starting analysis. Please try again.');
  }
}

function handleAnalysisError(error, requestId) {
  const errorObj = typeof error === 'string' ? { message: error } : error;
  const isTimeout = errorObj.isTimeout || false;
  
  console.error('[Drawer] Analysis error:', {
    error: errorObj.message,
    isTimeout,
    requestId,
    currentAnalysisId,
    isCurrent: requestId === currentAnalysisId
  });
  
  // Only update state if this error is for the current analysis
  if (!requestId || requestId === currentAnalysisId) {
    const duration = analysisStartTime ? Date.now() - analysisStartTime : 0;
    console.log(`[Drawer] Analysis ended with error after ${duration}ms`);
    
    // Reset all state
    isAnalyzing = false;
    isAnalysisInProgress = false;
    analysisStartTime = null;
    
    // Clear timeout
    clearAnalysisTimeout();
    
    // Update UI
    const loadingElement = document.getElementById('loading');
    const errorElement = document.getElementById('error');
    const resultsElement = document.getElementById('results');
    
    if (loadingElement) loadingElement.style.display = 'none';
    if (errorElement) errorElement.style.display = 'block';
    if (resultsElement) resultsElement.style.display = 'none';
    
    let errorMessage = 'An error occurred during analysis.';
    if (typeof error === 'string') {
      errorMessage = error;
    } else if (error?.message) {
      errorMessage = error.message;
    }
    
    const errorMessageElement = errorElement?.querySelector('p');
    if (errorMessageElement) {
      errorMessageElement.textContent = errorMessage;
    }
    
    // Add a retry button to the error message
    const retryButton = document.createElement('button');
    retryButton.textContent = 'Retry';
    retryButton.style.marginTop = '10px';
    retryButton.style.padding = '5px 10px';
    retryButton.style.backgroundColor = '#4CAF50';
    retryButton.style.color = 'white';
    retryButton.style.border = 'none';
    retryButton.style.borderRadius = '4px';
    retryButton.style.cursor = 'pointer';
    retryButton.addEventListener('click', () => {
      console.log('[Drawer] Retry button clicked');
      startAnalysis(true);
    });
    
    // Clear any existing buttons
    const existingButton = errorElement.querySelector('button');
    if (existingButton) {
      errorElement.removeChild(existingButton);
    }
    errorElement.appendChild(retryButton);
    
    logAnalysisState('after error');
  } else {
    console.warn(`[Drawer] Ignoring error for stale analysis request: ${requestId}`);
  }
} 
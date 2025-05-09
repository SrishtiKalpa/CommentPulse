// Store chart instances so they can be destroyed before creating new ones
let sentimentChart = null;
let engagementChart = null;
let currentVideoId = null;

document.addEventListener('DOMContentLoaded', () => {
  const analyzeBtn = document.getElementById('analyze-btn');
  const closeBtn = document.getElementById('close-drawer');
  const loadingDiv = document.getElementById('loading');
  const errorDiv = document.getElementById('error');
  const contentDiv = document.getElementById('content');
  const summaryLoading = document.getElementById('summary-loading');
  const summaryContent = document.getElementById('summary-content');
  
  // Listen for close button click
  closeBtn.addEventListener('click', () => {
    // If we have a current video ID and analysis was performed, delete the analysis directory
    if (currentVideoId) {
      deleteAnalysisDirectory(currentVideoId);
    }
    
    // Send message to content script to close drawer
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'closeDrawer' });
    });
    
    // Also send a message to the parent window (content script)
    window.parent.postMessage({
      source: 'comment-pulse-drawer',
      action: 'closeDrawer'
    }, '*');
  });
  
  // Function to delete the analysis directory
  async function deleteAnalysisDirectory(videoId) {
    try {
      // Get API endpoint
      let apiUrl = 'http://localhost:8000';
      try {
        const hostPermissions = chrome.runtime.getManifest().host_permissions;
        if (hostPermissions && hostPermissions.length > 0) {
          apiUrl = hostPermissions[0].replace('/*', '');
        }
      } catch (error) {
        console.warn('Could not get API URL from manifest, using default:', error);
      }
      
      console.log(`Attempting to delete analysis directory for video ${videoId}`);
      
      // Send delete request to the API
      const response = await fetch(`${apiUrl}/cleanup/${videoId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Analysis directory deleted:', result);
      } else {
        console.error('Failed to delete analysis directory:', response.statusText);
      }
    } catch (error) {
      console.error('Error deleting analysis directory:', error);
    }
  }
  
  // Listen for messages from content script and background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Drawer received message:', message);
    
    if (message.action === 'initDrawer' && message.videoId) {
      currentVideoId = message.videoId;
      
      // Reset UI
      resetUI();
      
      // Enable analyze button
      analyzeBtn.disabled = false;
      
      // Start analysis
      analyzeComments(message.videoId);
    } else if (message.action === 'closeDrawer') {
      // Handle close action if needed
      if (currentVideoId) {
        deleteAnalysisDirectory(currentVideoId);
      }
    } else if (message.action === 'cleanup' && message.videoId) {
      // Handle cleanup request
      deleteAnalysisDirectory(message.videoId);
    }
    
    return true; // Will respond asynchronously
  });
  
  // Also listen for messages from the window (from content script)
  window.addEventListener('message', (event) => {
    // Make sure the message is from our content script
    if (event.data && event.data.source === 'comment-pulse-content') {
      console.log('Drawer received window message:', event.data);
      
      if (event.data.action === 'initDrawer' && event.data.videoId) {
        currentVideoId = event.data.videoId;
        
        // Reset UI
        resetUI();
        
        // Enable analyze button
        analyzeBtn.disabled = false;
      } else if (event.data.action === 'cleanup' && event.data.videoId) {
        // Handle cleanup request when tab is closing
        console.log('Received cleanup request for video ID:', event.data.videoId);
        deleteAnalysisDirectory(event.data.videoId);
      } else if (event.data.action === 'closeDrawer') {
        // Handle close request
        if (currentVideoId) {
          deleteAnalysisDirectory(currentVideoId);
        }
      }
    }
  });
  
  // Add click handler for analyze button
  analyzeBtn.addEventListener('click', () => {
    if (currentVideoId) {
      analyzeComments(currentVideoId);
    } else {
      showError('No video ID found. Please refresh the page and try again.');
    }
  });
  
  // Helper function to reset the UI
  function resetUI() {
    errorDiv.classList.remove('active');
    loadingDiv.classList.remove('active');
    contentDiv.style.display = 'none';
    
    // Reset charts if they exist
    if (sentimentChart) {
      sentimentChart.destroy();
      sentimentChart = null;
    }
    
    if (engagementChart) {
      engagementChart.destroy();
      engagementChart = null;
    }
    
    // Reset summary section
    summaryLoading.classList.remove('active');
    summaryContent.style.display = 'none';
    
    // Reset stats
    document.getElementById('total-comments').textContent = '-';
    document.getElementById('avg-sentiment').textContent = '-';
    document.getElementById('top-topic').textContent = '-';
    document.getElementById('engagement-score').textContent = '-';
    
    // Reset visualizations
    document.getElementById('visualizations-grid').innerHTML = '';
  }
  
  function showError(message) {
    console.error('Error:', message);
    errorDiv.textContent = message;
    errorDiv.classList.add('active');
    loadingDiv.classList.remove('active');
    contentDiv.style.display = 'none';
  }
  
  function showLoading() {
    errorDiv.classList.remove('active');
    loadingDiv.classList.add('active');
    contentDiv.style.display = 'none';
  }
  
  function showContent() {
    errorDiv.classList.remove('active');
    loadingDiv.classList.remove('active');
    contentDiv.style.display = 'block';
  }
  
  async function analyzeComments(videoId) {
    showLoading();
    
    // Show a progress message to the user
    document.getElementById('loading-message').textContent = 'Starting analysis...';
    
    let controller;
    let timeoutId;
    
    try {
      // Get API endpoint from environment or default to localhost
      let apiUrl = 'http://localhost:8000';
      try {
        // Try to get the URL from manifest, but use default if anything fails
        const hostPermissions = chrome.runtime.getManifest().host_permissions;
        if (hostPermissions && hostPermissions.length > 0) {
          apiUrl = hostPermissions[0].replace('/*', '');
        }
      } catch (error) {
        console.warn('Could not get API URL from manifest, using default:', error);
      }
      
      console.log('Using API URL:', apiUrl);
      
      // Use a much shorter timeout (30 seconds) but implement progressive loading
      controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      // Update the loading message
      document.getElementById('loading-message').textContent = 'Fetching comments...';
      
      // First, make a lightweight request to check if the video exists and get basic info
      try {
        const checkResponse = await fetch(`${apiUrl}/health`, {
          method: 'GET',
          signal: controller.signal
        });
        
        if (checkResponse.ok) {
          console.log('Server is healthy, proceeding with analysis');
        } else {
          console.warn('Server health check failed:', checkResponse.status);
        }
      } catch (e) {
        console.warn('Server health check failed:', e);
        // Continue anyway, the main request will handle errors
      }
      
      // Update the loading message
      document.getElementById('loading-message').textContent = 'Analyzing comments (this may take a moment)...';
      
      console.log('Sending request to:', `${apiUrl}/analyze`);
      console.log('Request payload:', { video_id: videoId, days_back: 7, max_comments: 250 }); // Further reduced for faster response
      
      // Wrap fetch in a try-catch to handle network errors more gracefully
      let response;
      try {
        response = await fetch(`${apiUrl}/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            video_id: videoId,
            days_back: 7,
            max_comments: 250 // Further reduced for faster response
          }),
          signal: controller.signal
        });
      } catch (fetchError) {
        console.error('Fetch error:', fetchError);
        if (fetchError.name === 'AbortError') {
          // Create a fallback response with placeholder data
          showFallbackResults(videoId);
          throw new Error('Request timed out');
        } else {
          throw new Error(`Network error: ${fetchError.message}`);
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      
      console.log('Response status:', response.status, response.statusText);
      
      // Handle non-OK responses
      if (!response.ok) {
        let errorDetail = '';
        try {
          const errorData = await response.json();
          errorDetail = errorData.detail || '';
        } catch (e) {
          // If we can't parse the JSON, just use the status text
          console.warn('Could not parse error response:', e);
        }
        
        throw new Error(`Server error (${response.status}): ${errorDetail || response.statusText}`);
      }
      
      // Get response text first
      let responseText;
      try {
        responseText = await response.text();
        console.log('Response text length:', responseText.length);
        if (responseText.length < 100) {
          console.log('Raw response text:', responseText); // Only log full text if it's short
        } else {
          console.log('Raw response text (truncated):', responseText.substring(0, 100) + '...');
        }
      } catch (textError) {
        console.error('Error reading response text:', textError);
        throw new Error('Could not read server response');
      }
      
      // Parse the response as JSON
      let responseData;
      try {
        // Check if response is empty
        if (!responseText || responseText.trim() === '') {
          throw new Error('Empty response from server');
        }
        
        responseData = JSON.parse(responseText);
        console.log('Response parsed successfully');
      } catch (parseError) {
        console.error('Error parsing JSON response:', parseError);
        throw new Error(`Failed to parse server response: ${responseText.substring(0, 100)}...`);
      }
      
      // Validate the response data
      if (!responseData) {
        throw new Error('Empty response data from server');
      }
      
      // Check if the response has the expected structure
      if (!responseData.analysis_results) {
        console.warn('Response missing analysis_results:', responseData);
        // Try to create a valid structure if possible
        responseData = {
          video_id: videoId,
          analysis_results: responseData,
          summary: responseData.summary_paragraph || 'No summary available',
          visualizations: []
        };
      }
      
      // Display the results
      displayResults(responseData);
      showContent();
    } catch (error) {
      console.error('Analysis error:', error);
      
      // Provide more helpful error messages
      if (error.name === 'AbortError' || error.message.includes('timed out')) {
        showError('Request timed out. The server might be overloaded, please try again later.');
      } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('Network error')) {
        showError('Could not connect to the analysis server. Please check if the server is running.');
      } else if (error.message.includes('parse')) {
        showError('Error processing server response. The response format may be invalid.');
      } else {
        showError(`Error analyzing comments: ${error.message}`);
      }
    }
  }
  
  function displayResults(responseData) {
    console.log('Displaying results from API response');
    
    try {
      // Ensure we have valid data
      if (!responseData || typeof responseData !== 'object') {
        console.error('Invalid response data:', responseData);
        showError('Invalid response from server');
        return;
      }
      
      // Handle different API response formats
      let data;
      if (responseData.analysis_results) {
        // Format: { analysis_results: {...} }
        console.log('Response format: Contains analysis_results object');
        data = responseData;
      } else if (responseData.total_comments !== undefined) {
        // Format: Direct analysis results object
        console.log('Response format: Direct analysis results object');
        data = { analysis_results: responseData };
      } else if (responseData.error) {
        // Format: Error object
        console.error('Server returned error:', responseData.error);
        showError(`Server error: ${responseData.error}`);
        return;
      } else {
        // Try to determine if any part of the response could be used as analysis results
        console.warn('Unrecognized response format, attempting to recover');
        
        // Look for objects that might contain analysis data
        let possibleResults = null;
        for (const key in responseData) {
          if (typeof responseData[key] === 'object' && responseData[key] !== null) {
            // Check if this object has any of the expected properties
            const obj = responseData[key];
            if (obj.total_comments !== undefined || 
                obj.sentiment_distribution !== undefined || 
                obj.summary_paragraph !== undefined) {
              possibleResults = obj;
              console.log(`Found possible analysis results in property: ${key}`);
              break;
            }
          }
        }
        
        if (possibleResults) {
          data = { analysis_results: possibleResults };
        } else {
          // Last resort: treat the entire response as analysis results
          console.warn('Could not find analysis results structure, using entire response');
          data = { 
            analysis_results: responseData,
            summary: 'Unable to extract proper summary from response'
          };
        }
      }
      
      // Ensure analysis_results exists and is an object
      if (!data.analysis_results || typeof data.analysis_results !== 'object') {
        console.error('Missing or invalid analysis_results:', data);
        showError('Missing or invalid analysis results in server response');
        return;
      }
      
      // Log the structure we're working with
      console.log('Working with data structure:', {
        has_total_comments: data.analysis_results.total_comments !== undefined,
        has_sentiment: data.analysis_results.average_sentiment_score !== undefined,
        has_engagement: data.analysis_results.engagement_rate !== undefined,
        has_summary: Boolean(data.summary || data.analysis_results.summary_paragraph)
      });
      
      // Update stats with fallbacks for missing data
      document.getElementById('total-comments').textContent = 
        data.analysis_results.total_comments !== undefined ? data.analysis_results.total_comments : 'N/A';
        
      document.getElementById('avg-sentiment').textContent = 
        data.analysis_results.average_sentiment_score !== undefined ? 
        (data.analysis_results.average_sentiment_score * 100).toFixed(1) + '%' : 'N/A';
      
      // For top topic, we don't have this in the API response, so display summary instead
      document.getElementById('top-topic').textContent = 'See summary';
      
      document.getElementById('engagement-score').textContent = 
        data.analysis_results.engagement_rate !== undefined ? 
        (data.analysis_results.engagement_rate * 100).toFixed(1) + '%' : 'N/A';
      
      // Process and display summary
      const summaryLoading = document.getElementById('summary-loading');
      const summaryContent = document.getElementById('summary-content');
      const summaryText = document.getElementById('summary-text');
      const summaryHighlightsList = document.getElementById('summary-highlights-list');
      
      // Show loading state
      summaryLoading.classList.add('active');
      summaryContent.style.display = 'none';
      
      // Get the summary text with multiple fallbacks
      let summaryRawText = 'No summary available';
      
      if (data.summary && typeof data.summary === 'string' && data.summary.length > 10) {
        summaryRawText = data.summary;
        console.log('Using data.summary');
      } else if (data.analysis_results.summary_paragraph && 
                typeof data.analysis_results.summary_paragraph === 'string' && 
                data.analysis_results.summary_paragraph.length > 10) {
        summaryRawText = data.analysis_results.summary_paragraph;
        console.log('Using data.analysis_results.summary_paragraph');
      } else if (data.analysis_results.summary && 
                typeof data.analysis_results.summary === 'string' && 
                data.analysis_results.summary.length > 10) {
        summaryRawText = data.analysis_results.summary;
        console.log('Using data.analysis_results.summary');
      }
      
      console.log('Summary text length:', summaryRawText.length);
      
      // Process the summary to extract key insights
      processAndDisplaySummary(summaryRawText, summaryText, summaryHighlightsList);
      
      // Hide loading and show content
      summaryLoading.classList.remove('active');
      summaryContent.style.display = 'flex';
      
      // Create charts and display visualizations
      try {
        createCharts(data);
        displayVisualizations(data);
      } catch (chartError) {
        console.error('Error creating charts:', chartError);
        // Continue execution even if charts fail
      }
    } catch (error) {
      console.error('Error displaying results:', error);
      showError(`Error displaying results: ${error.message}`);
    }
  }
  
  // Process the summary text to extract key insights and format the detailed text
  function processAndDisplaySummary(summaryText, summaryTextElement, highlightsListElement) {
    // Clear existing highlights
    highlightsListElement.innerHTML = '';
    
    if (!summaryText || summaryText === 'No summary available') {
      summaryTextElement.textContent = 'No summary available for this video\'s comments.';
      const noDataLi = document.createElement('li');
      noDataLi.textContent = 'No insights available';
      highlightsListElement.appendChild(noDataLi);
      return;
    }
    
    // Format the summary text with proper line breaks and spacing
    const formattedText = summaryText
      .replace(/\. /g, '.\n')
      .replace(/\! /g, '!\n')
      .replace(/\? /g, '?\n')
      .replace(/\n\n/g, '\n')
      .trim();
    
    summaryTextElement.textContent = formattedText;
    
    // Extract key insights from the summary
    const sentences = summaryText.split(/[.!?]\s+/);
    const keyInsights = [];
    
    // Look for sentences with indicators of importance
    const importanceIndicators = [
      'most', 'majority', 'primarily', 'mainly', 'largely',
      'significant', 'notably', 'interestingly', 'surprisingly',
      'overall', 'generally', 'typically', 'commonly',
      'positive', 'negative', 'neutral', 'mixed',
      'high', 'low', 'average', 'median',
      'increase', 'decrease', 'change', 'trend',
      'recommend', 'suggest', 'advise', 'propose',
      'highlight', 'emphasize', 'underscore', 'stress'
    ];
    
    // Find sentences with numbers or percentages
    const numberPattern = /\d+(\.\d+)?%|\d+/;
    
    // Collect sentences that contain importance indicators or numbers
    sentences.forEach(sentence => {
      if (sentence.trim().length < 5) return; // Skip very short sentences
      
      const lowerSentence = sentence.toLowerCase();
      const hasIndicator = importanceIndicators.some(indicator => lowerSentence.includes(indicator));
      const hasNumber = numberPattern.test(sentence);
      
      if (hasIndicator || hasNumber) {
        keyInsights.push(sentence.trim() + '.');
      }
    });
    
    // If we couldn't find good insights, use the first 2-3 sentences
    if (keyInsights.length < 2 && sentences.length > 0) {
      const maxSentences = Math.min(3, sentences.length);
      for (let i = 0; i < maxSentences; i++) {
        if (sentences[i].trim().length > 5) {
          keyInsights.push(sentences[i].trim() + '.');
        }
      }
    }
    
    // Remove duplicates and limit to 5 insights
    const uniqueInsights = [...new Set(keyInsights)].slice(0, 5);
    
    // Add insights to the list
    uniqueInsights.forEach(insight => {
      const li = document.createElement('li');
      li.textContent = insight;
      highlightsListElement.appendChild(li);
    });
    
    // If still no insights, add a default message
    if (highlightsListElement.children.length === 0) {
      const defaultLi = document.createElement('li');
      defaultLi.textContent = 'See detailed analysis below for insights.';
      highlightsListElement.appendChild(defaultLi);
    }
    
  }
  
  // Create charts for sentiment and engagement
  function createCharts(data) {
    if (!data || !data.analysis_results) return;
    
    // Extract sentiment distribution with proper error handling
    const sentimentDistribution = data.analysis_results.sentiment_distribution || {};
    const positive = (sentimentDistribution && sentimentDistribution.positive) || 0;
    const neutral = (sentimentDistribution && sentimentDistribution.neutral) || 0;
    const negative = (sentimentDistribution && sentimentDistribution.negative) || 0;
    const total = positive + neutral + negative || 1; // Avoid division by zero
    
    // Destroy existing sentiment chart if it exists
    if (sentimentChart) {
      sentimentChart.destroy();
    }
    
    // Create sentiment distribution chart
    const sentimentCtx = document.getElementById('sentiment-chart').getContext('2d');
    sentimentChart = new Chart(sentimentCtx, {
      type: 'pie',
      data: {
        labels: ['Positive', 'Neutral', 'Negative'],
        datasets: [{
          data: [
            (positive / total) * 100,
            (neutral / total) * 100,
            (negative / total) * 100
          ],
          backgroundColor: ['#34a853', '#fbbc05', '#ea4335']
        }]
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: 'Sentiment Distribution'
          }
        }
      }
    });
    
    // Destroy existing engagement chart if it exists
    if (engagementChart) {
      engagementChart.destroy();
    }
    
    // Since we don't have engagement over time data in the API response,
    // display a simple bar chart with engagement rate
    const engagementCtx = document.getElementById('engagement-chart').getContext('2d');
    engagementChart = new Chart(engagementCtx, {
      type: 'bar',
      data: {
        labels: ['Engagement Rate'],
        datasets: [{
          label: 'Engagement',
          data: [data.analysis_results.engagement_rate || 0],
          backgroundColor: '#1a73e8'
        }]
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: 'Engagement Rate'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 1
          }
        }
      }
    });
    
  }
  
  // Display visualization images
  function displayVisualizations(data) {
    if (!data) return;
    
    const visualizationsGrid = document.getElementById('visualizations-grid');
    visualizationsGrid.innerHTML = ''; // Clear existing content
    
    // Define the standard PNG visualizations we want to display
    const standardVisualizations = [
      {
        title: 'Sentiment Distribution',
        filename: 'sentiment_distribution.png'
      },
      {
        title: 'Word Cloud',
        filename: 'wordcloud.png'
      },
      {
        title: 'Engagement Over Time',
        filename: 'engagement_over_time.png'
      },
      {
        title: 'Activity Heatmap',
        filename: 'activity_heatmap.png'
      }
    ];
    
    // Create a title for the visualizations section
    const sectionTitle = document.createElement('h3');
    sectionTitle.textContent = 'Visualizations';
    sectionTitle.style.marginTop = '20px';
    sectionTitle.style.marginBottom = '15px';
    sectionTitle.style.color = '#1a73e8';
    sectionTitle.style.textAlign = 'center';
    visualizationsGrid.appendChild(sectionTitle);
    
    // Add image path information for debugging
    const pathInfo = document.createElement('div');
    pathInfo.style.fontSize = '0.8em';
    pathInfo.style.color = '#666';
    pathInfo.style.textAlign = 'center';
    pathInfo.style.marginBottom = '15px';
    pathInfo.innerHTML = `Loading from: <code>http://localhost:8000/analysis/analysis_${currentVideoId}/</code>`;
    visualizationsGrid.appendChild(pathInfo);
    
    // Add each visualization
    standardVisualizations.forEach(viz => {
      const vizContainer = document.createElement('div');
      vizContainer.style.marginBottom = '25px';
      vizContainer.style.padding = '15px';
      vizContainer.style.backgroundColor = '#f8f9fa';
      vizContainer.style.borderRadius = '8px';
      vizContainer.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      
      // Create a title for the visualization
      const vizTitle = document.createElement('h4');
      vizTitle.textContent = viz.title;
      vizTitle.style.margin = '0 0 15px 0';
      vizTitle.style.color = '#202124';
      vizTitle.style.textAlign = 'center';
      
      // Create the image element
      const img = document.createElement('img');
      const imageUrl = `http://localhost:8000/analysis/analysis_${currentVideoId}/${viz.filename}`;
      img.src = imageUrl;
      img.alt = viz.title;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      img.style.borderRadius = '8px';
      img.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
      img.style.display = 'none'; // Hide initially until loaded
      
      console.log(`Loading visualization: ${imageUrl}`);
      
      // Add loading indicator
      const loadingIndicator = document.createElement('div');
      loadingIndicator.textContent = 'Loading visualization...';
      loadingIndicator.style.textAlign = 'center';
      loadingIndicator.style.color = '#666';
      loadingIndicator.style.padding = '20px';
      
      // Handle image loading errors
      img.onerror = function() {
        console.error(`Failed to load visualization: ${imageUrl}`);
        loadingIndicator.style.display = 'none';
        const errorMsg = document.createElement('div');
        errorMsg.style.textAlign = 'center';
        errorMsg.style.color = '#ea4335';
        errorMsg.style.padding = '20px';
        errorMsg.innerHTML = 'Could not load visualization<br><small>Make sure the API server is running and visualizations were generated</small>';
        
        // Add direct link to try accessing the image directly
        const directLinkDiv = document.createElement('div');
        directLinkDiv.style.marginTop = '10px';
        directLinkDiv.style.fontSize = '0.9em';
        directLinkDiv.innerHTML = `<a href='${imageUrl}' target='_blank'>Try direct link</a>`;
        
        // Add a try different video ID suggestion
        const suggestionDiv = document.createElement('div');
        suggestionDiv.style.marginTop = '10px';
        suggestionDiv.style.fontSize = '0.9em';
        suggestionDiv.style.color = '#666';
        suggestionDiv.innerHTML = 'Try analyzing video ID: <strong>2u80yFDtszE</strong><br>This video has pre-generated visualizations';
        
        vizContainer.appendChild(errorMsg);
        vizContainer.appendChild(directLinkDiv);
        vizContainer.appendChild(suggestionDiv);
      };
      
      // Handle successful image loading
      img.onload = function() {
        loadingIndicator.style.display = 'none';
        img.style.display = 'block';
        img.style.opacity = '1';
        console.log(`Successfully loaded visualization: ${imageUrl}`);
      };
      
      // Add elements to the container
      vizContainer.appendChild(vizTitle);
      vizContainer.appendChild(loadingIndicator);
      vizContainer.appendChild(img);
      visualizationsGrid.appendChild(vizContainer);
    });
    
    // Add a download link at the bottom
    const downloadContainer = document.createElement('div');
    downloadContainer.style.textAlign = 'center';
    downloadContainer.style.marginTop = '20px';
    
    const downloadLink = document.createElement('a');
    downloadLink.textContent = 'Download Analysis Results (JSON)';
    downloadLink.style.display = 'inline-block';
    downloadLink.style.padding = '8px 16px';
    downloadLink.style.backgroundColor = '#1a73e8';
    downloadLink.style.color = 'white';
    downloadLink.style.textDecoration = 'none';
    downloadLink.style.borderRadius = '4px';
    downloadLink.href = '#';
    downloadLink.onclick = function(e) {
      e.preventDefault();
      // Create a blob with the JSON data
      const jsonData = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonData], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      
      // Create a temporary link and click it to download
      const tempLink = document.createElement('a');
      tempLink.href = url;
      tempLink.download = `comment_analysis_${currentVideoId}.json`;
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      URL.revokeObjectURL(url);
    };
    
    downloadContainer.appendChild(downloadLink);
    visualizationsGrid.appendChild(downloadContainer);
  }
});

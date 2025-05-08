import os
import json
import time
import datetime
import requests
import logging
from typing import Optional, Dict, List, Any, Tuple
from datetime import datetime, timezone
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Configure logging
logger = logging.getLogger(__name__)

class YouTubeCommentsFetcher:
    def __init__(self, api_key: str, max_retries: int = 3):
        """
        Initialize the YouTube Comments Fetcher.
        
        Args:
            api_key (str): YouTube Data API v3 key
            max_retries (int): Maximum number of retries for API requests
        """
        self.api_key = api_key
        self.base_url = "https://www.googleapis.com/youtube/v3"
        
        # Setup session with retry logic
        self.session = requests.Session()
        retry_strategy = Retry(
            total=max_retries,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET"],
            backoff_factor=1
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("https://", adapter)
        
    def get_comments(
        self,
        video_id: str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        max_results: int = 100,
        max_pages: int = 10,  # Limit the number of pages to fetch
        early_stop_count: int = 1000  # Stop after collecting this many comments
    ) -> List[Dict[str, Any]]:
        """
        Fetches comments from a YouTube video with pagination and time range filtering.
        
        Args:
            video_id (str): The YouTube video ID
            start_time (datetime, optional): Start time for filtering comments
            end_time (datetime, optional): End time for filtering comments
            max_results (int, optional): Maximum number of comments to fetch per page
            max_pages (int, optional): Maximum number of pages to fetch (pagination limit)
            early_stop_count (int, optional): Stop after collecting this many comments
            
        Returns:
            List[Dict[str, Any]]: List of comment dictionaries
        """
        all_comments = []
        next_page_token = None
        page_count = 0
        
        logger.info(f"Starting comment fetch for video {video_id}")
        start_fetch_time = time.time()
        
        while True:
            # Stop if we've reached the page limit or comment count limit
            if page_count >= max_pages:
                logger.info(f"Reached maximum page limit ({max_pages})")
                break
                
            if len(all_comments) >= early_stop_count:
                logger.info(f"Reached early stop count ({early_stop_count} comments)")
                break
                
            page_count += 1
            
            # Prepare the API request parameters
            params = {
                'key': self.api_key,
                'videoId': video_id,
                'part': 'snippet',
                'maxResults': max_results,
                'order': 'time'
            }
            
            if next_page_token:
                params['pageToken'] = next_page_token
                
            # Make the API request with error handling
            try:
                logger.info(f"Fetching comments for video {video_id}, page {page_count}, token: {next_page_token}")
                response = self.session.get(
                    f"{self.base_url}/commentThreads",
                    params=params,
                    timeout=(5, 30)  # Increased timeouts: Connect timeout, Read timeout
                )
                
                # Check for rate limiting or server errors
                if response.status_code == 429 or response.status_code >= 500:
                    retry_after = int(response.headers.get('Retry-After', 5))
                    logger.warning(f"Rate limited or server error. Waiting {retry_after} seconds.")
                    time.sleep(retry_after)
                    continue  # Retry the same request
                    
                response.raise_for_status()
            except requests.exceptions.RequestException as e:
                logger.error(f"Error fetching comments for video {video_id}: {str(e)}")
                
                # Handle specific error cases
                try:
                    error_text = response.text if hasattr(response, 'text') else ""
                    if hasattr(response, 'status_code'):
                        if response.status_code == 403 and "quotaExceeded" in error_text:
                            raise Exception("YouTube API quota exceeded. Try again later.")
                        elif response.status_code == 404:
                            raise Exception(f"Video {video_id} not found or comments are disabled.")
                except Exception as specific_error:
                    raise specific_error
                    
                # Return partial results if we have some comments already
                if all_comments:
                    logger.warning(f"Returning {len(all_comments)} comments collected before error")
                    return all_comments
                else:
                    raise Exception(f"API request failed: {str(e)}")
            
            # Handle empty response
            if not response.text:
                logger.warning(f"Empty response received for video {video_id}")
                break
            
            try:
                data = response.json()
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON response: {str(e)}")
                if all_comments:
                    return all_comments  # Return what we have so far
                raise Exception(f"Failed to parse API response: {str(e)}")
            
            # Process comments
            items = data.get('items', [])
            logger.info(f"Received {len(items)} comments on page {page_count}")
            
            for item in items:
                try:
                    comment = item['snippet']['topLevelComment']['snippet']
                    published_at = datetime.fromisoformat(comment['publishedAt'].replace('Z', '+00:00'))
                    
                    # Apply time range filter if specified
                    if start_time and published_at < start_time:
                        continue
                    if end_time and published_at > end_time:
                        continue
                        
                    all_comments.append({
                        'author': comment['authorDisplayName'],
                        'text': comment['textDisplay'],
                        'published_at': comment['publishedAt'],
                        'updated_at': comment.get('updatedAt', comment['publishedAt']),
                        'like_count': comment.get('likeCount', 0)
                    })
                except KeyError as e:
                    logger.warning(f"Skipping comment due to missing field: {str(e)}")
                    continue
            
            # Check if there are more pages
            next_page_token = data.get('nextPageToken')
            if not next_page_token:
                break
                
            # Respect YouTube API rate limits but with adaptive backoff
            # Use shorter waits for the first few pages, longer for later pages
            if page_count <= 3:
                time.sleep(0.3)  # Faster for first few pages
            else:
                time.sleep(0.5)  # Standard rate limit respect
        
        fetch_duration = time.time() - start_fetch_time
        logger.info(f"Completed fetching {len(all_comments)} comments for video {video_id} in {fetch_duration:.2f} seconds")
        return all_comments

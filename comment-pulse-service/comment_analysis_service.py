from youtube_comments_fetcher import YouTubeCommentsFetcher
from comment_analyzer import CommentAnalyzer
from datetime import datetime, timezone, timedelta
import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional
from collections import Counter
import re
from nltk.sentiment.vader import SentimentIntensityAnalyzer
import nltk
import matplotlib.pyplot as plt
import seaborn as sns
from wordcloud import WordCloud
import json
import os
import time  # Add missing time module import
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

# Download required NLTK data
try:
    nltk.data.find('vader_lexicon')
except LookupError:
    nltk.download('vader_lexicon', quiet=True)

class CommentAnalysisService:
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the comment analysis service.
        
        Args:
            api_key (str, optional): YouTube Data API key. If not provided, will try to get from environment.
        """
        self.api_key = api_key or os.getenv('YOUTUBE_API_KEY')
        if not self.api_key:
            raise ValueError("YouTube API key not found. Please provide it as an argument or set YOUTUBE_API_KEY environment variable.")
        
        self.fetcher = YouTubeCommentsFetcher(self.api_key)
        self.analyzer = CommentAnalyzer()
        
    def analyze_video_comments(
        self,
        video_id: str,
        days_back: int = 7,
        max_comments: int = 1000,
        max_pages: int = 10,
        output_dir: str = '.',
        timeout_seconds: int = 25  # Add timeout parameter with default of 25 seconds
    ) -> Dict[str, Any]:
        """
        Analyze comments for a video and return comprehensive metrics.
        
        Args:
            video_id (str): YouTube video ID
            days_back (int): Number of days to look back for comments
            max_comments (int): Maximum number of comments to analyze
            max_pages (int): Maximum number of pages to fetch (pagination limit)
            output_dir (str): Directory to save visualizations
            timeout_seconds (int): Maximum time to spend on comment fetching
            
        Returns:
            Dict containing various metrics and insights
        """
        # Set up timing for timeout
        analysis_start_time = time.time()
        
        # Fetch comments
        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(days=days_back)
        
        # Log the start of comment fetching
        print(f"Fetching comments for video {video_id}, looking back {days_back} days, max {max_comments} comments")
        
        try:
            # Use a smaller number of comments and pages for faster response
            adjusted_max_comments = min(max_comments, 250)  # Further limit comments
            adjusted_max_pages = min(max_pages, 3)  # Limit to 3 pages max
            
            comments = self.fetcher.get_comments(
                video_id=video_id,
                start_time=start_time,
                end_time=end_time,
                max_results=min(100, adjusted_max_comments // 2),  # Optimize page size
                max_pages=adjusted_max_pages,
                early_stop_count=adjusted_max_comments
            )
            
            # Check if we've exceeded our timeout
            if (time.time() - analysis_start_time) > timeout_seconds:
                print(f"Comment fetching timeout exceeded ({timeout_seconds}s), returning partial results")
                # Return partial results if we have some comments
                if comments:
                    return self._analyze_available_comments(comments, video_id, output_dir, partial=True)
                else:
                    return {
                        "error": f"Timeout exceeded ({timeout_seconds}s) while fetching comments",
                        "total_comments": 0,
                        "summary_paragraph": "Analysis timed out. The server took too long to fetch comments. Try again with a video that has fewer comments."
                    }
        except Exception as e:
            print(f"Error fetching comments: {str(e)}")
            return {
                "error": f"Error fetching comments: {str(e)}",
                "total_comments": 0,
                "summary_paragraph": f"Error analyzing comments: {str(e)}"
            }
        
        if not comments:
            return {"error": "No comments found for the specified period"}
        
        # Process the comments we have
        return self._analyze_available_comments(comments, video_id, output_dir)
    
    def _analyze_available_comments(self, comments, video_id, output_dir, partial=False):
        """
        Analyze the available comments and return metrics.
        
        Args:
            comments (list): List of comments to analyze
            video_id (str): YouTube video ID
            output_dir (str): Directory to save visualizations
            partial (bool): Whether these are partial results due to timeout
            
        Returns:
            Dict containing metrics and insights based on available comments
        """
        try:
            # Convert to DataFrame for analysis
            df = pd.DataFrame(comments)
            
            # Perform analysis
            metrics = self.analyzer.analyze_comments(comments)
            
            # Add a flag to indicate if these are partial results
            if partial:
                metrics['partial_results'] = True
                metrics['comments_analyzed'] = len(comments)
                metrics['summary_paragraph'] = f"Partial analysis based on {len(comments)} comments. The full analysis would take longer. {metrics.get('summary_paragraph', '')}".strip()
            
            # Try to generate visualizations, but don't fail if they can't be created
            try:
                self.analyzer.generate_visualizations(df, output_dir)
            except Exception as viz_error:
                print(f"Error generating visualizations: {str(viz_error)}")
                metrics['visualizations'] = []
            
            return metrics
        except Exception as e:
            print(f"Error in _analyze_available_comments: {str(e)}")
            return {
                "error": f"Error analyzing comments: {str(e)}",
                "total_comments": len(comments),
                "comments_analyzed": len(comments),
                "partial_results": True,
                "summary_paragraph": f"Error during analysis: {str(e)}. Analyzed {len(comments)} comments."
            }
    
    def save_analysis_results(self, results: Dict[str, Any], output_file: str = 'analysis_results.json'):
        """
        Save analysis results to a JSON file.
        
        Args:
            results (Dict): Analysis results to save
            output_file (str): Path to save the results
        """
        # Convert numpy types to Python types for JSON serialization
        class NumpyEncoder(json.JSONEncoder):
            def default(self, obj):
                if isinstance(obj, np.integer):
                    return int(obj)
                if isinstance(obj, np.floating):
                    return float(obj)
                if isinstance(obj, np.ndarray):
                    return obj.tolist()
                return super(NumpyEncoder, self).default(obj)
        
        # Save full results to JSON
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, cls=NumpyEncoder)
        
        # Save summary to a separate text file
        summary_file = 'comment_analysis_summary.txt'
        with open(summary_file, 'w', encoding='utf-8') as f:
            # Check if summary_paragraph exists in results
            if 'summary_paragraph' in results:
                f.write(results['summary_paragraph'])
            else:
                # Generate a basic summary if missing
                summary = f"Analysis summary for video with {results.get('total_comments', 0)} comments.\n"
                f.write(summary)

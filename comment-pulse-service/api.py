from fastapi import FastAPI, HTTPException, Depends, Request, BackgroundTasks, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import APIKeyHeader
from fastapi_limiter import FastAPILimiter
from fastapi_limiter.depends import RateLimiter
import redis.asyncio as redis
import secrets
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional, Dict, Any, List, Union
from comment_analysis_service import CommentAnalysisService
import uvicorn
from dotenv import load_dotenv
import os
import numpy as np
import json
import re
from datetime import datetime, timedelta
from functools import lru_cache
import logging
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# API security
API_KEY = os.getenv("API_KEY", secrets.token_urlsafe(32))  # Generate a random key if not set
API_KEY_NAME = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

async def get_api_key(api_key_header: str = Depends(api_key_header)):
    if api_key_header == API_KEY:
        return api_key_header
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid API Key",
    )

# Initialize FastAPI app
app = FastAPI(
    title="CommentPulse API",
    description="API for analyzing YouTube video comments",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Setup rate limiter
@app.on_event("startup")
async def startup():
    try:
        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        redis_instance = redis.from_url(redis_url, encoding="utf-8", decode_responses=True)
        await FastAPILimiter.init(redis_instance)
        logger.info("Rate limiter initialized successfully")
    except Exception as e:
        logger.warning(f"Failed to initialize rate limiter: {e}. Rate limiting disabled.")

@app.on_event("shutdown")
async def shutdown():
    try:
        await FastAPILimiter.close()
    except Exception:
        pass

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Function to ensure an analysis directory exists and is tracked
def mount_analysis_directory(video_id: str):
    directory = f"analysis_{video_id}"
    try:
        # Check if directory exists
        if os.path.isdir(directory):
            # Keep track of mounted directories
            if not hasattr(app, "_mounted_directories"):
                app._mounted_directories = set()
            app._mounted_directories.add(directory)
            logger.info(f"Analysis directory available: {directory}")
            return True
        return False
    except Exception as e:
        logger.error(f"Error tracking directory {directory}: {str(e)}")
        return False

# Mount static files
try:
    app.mount('/static', StaticFiles(directory='static'), name='static')
    logger.info("Mounted static directory")
except Exception as e:
    logger.warning(f"Could not mount static directory: {str(e)}")

# Create static directory if it doesn't exist
if not os.path.exists('static'):
    try:
        os.makedirs('static', exist_ok=True)
        logger.info("Created static directory")
    except Exception as e:
        logger.warning(f"Could not create static directory: {str(e)}")

# Create a single mount point for all analysis directories
try:
    # First, unmount any previously mounted directories to avoid conflicts
    if hasattr(app, "_mounted_directories"):
        for directory in list(app._mounted_directories):
            try:
                # We can't actually unmount in FastAPI, but we can remove it from our tracking
                app._mounted_directories.remove(directory)
                logger.info(f"Unmounted directory: {directory}")
            except Exception as e:
                logger.error(f"Error unmounting directory {directory}: {str(e)}")
    
    # Mount each analysis directory individually
    try:
        # First, mount the static directory
        if os.path.exists('static'):
            app.mount('/static', StaticFiles(directory='static'), name='static')
            logger.info("Mounted static directory")
        
        # Then, mount each analysis directory individually
        for directory in [d for d in os.listdir() if d.startswith("analysis_") and os.path.isdir(d)]:
            try:
                app.mount(f"/analysis/{directory}", StaticFiles(directory=directory), name=directory)
                logger.info(f"Mounted analysis directory: {directory}")
            except Exception as e:
                logger.error(f"Error mounting directory {directory}: {str(e)}")
    except Exception as e:
        logger.error(f"Error mounting directories: {str(e)}")
    
    # Initialize mounted directories tracking
    if not hasattr(app, "_mounted_directories"):
        app._mounted_directories = set()
    
    # Log all available analysis directories
    existing_dirs = [d for d in os.listdir() if d.startswith("analysis_") and os.path.isdir(d)]
    for directory in existing_dirs:
        logger.info(f"Analysis directory available: {directory}")
except Exception as e:
    logger.warning(f"Error setting up analysis directories: {str(e)}")



def convert_numpy_types(obj: Any) -> Any:
    """Convert numpy types to Python native types."""
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {key: convert_numpy_types(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(item) for item in obj]
    return obj

class VideoAnalysisRequest(BaseModel):
    video_id: str = Field(..., min_length=11, max_length=11)
    days_back: Optional[int] = Field(default=7, ge=1, le=30)
    max_comments: Optional[int] = Field(default=1000, ge=1, le=10000)

    @field_validator('video_id')
    @classmethod
    def validate_video_id(cls, v: str) -> str:
        if not re.match(r'^[a-zA-Z0-9_-]{11}$', v):
            raise ValueError('Invalid YouTube video ID format')
        return v

class AnalysisResults(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    
    total_comments: Union[int, np.int64]
    unique_authors: Union[int, np.int64]
    total_likes: Union[int, np.int64]
    average_likes_per_comment: Union[float, np.float64]
    engagement_rate: Union[float, np.float64]
    sentiment_distribution: Dict[str, Union[int, np.int64]]
    average_sentiment_score: Union[float, np.float64]
    summary_paragraph: str
    visualizations: List[str]
    
    @field_validator('visualizations')
    @classmethod
    def validate_visualizations(cls, v: List[str]) -> List[str]:
        """Ensure visualization paths are properly formatted."""
        # Remove any duplicate slashes and ensure proper format
        return [f"/analysis_{os.path.basename(path)}" if path.startswith('/') else f"/analysis_{path}" for path in v]

class VideoAnalysisResponse(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    
    video_id: str
    analysis_results: AnalysisResults
    summary: str
    visualizations: List[str]
    cached: bool = False
    timestamp: datetime
    processing_time: Optional[float] = None

# Cache for analysis results
analysis_cache = {}

def get_cache_key(video_id: str, days_back: int, max_comments: int) -> str:
    return f"{video_id}_{days_back}_{max_comments}"

@lru_cache(maxsize=100)
def get_cached_analysis(cache_key: str) -> Optional[Dict]:
    return analysis_cache.get(cache_key)

def save_to_cache(cache_key: str, data: Dict):
    analysis_cache[cache_key] = {
        'data': convert_numpy_types(data),
        'timestamp': datetime.now()
    }

def cleanup_old_cache():
    """Remove cache entries older than 24 hours"""
    current_time = datetime.now()
    keys_to_remove = []
    for key, value in analysis_cache.items():
        if (current_time - value['timestamp']) > timedelta(hours=24):
            keys_to_remove.append(key)
    for key in keys_to_remove:
        del analysis_cache[key]

@app.post("/analyze", response_model=VideoAnalysisResponse)
async def analyze_video(
    request: VideoAnalysisRequest,
    background_tasks: BackgroundTasks,
    req: Request,
    # Rate limit: 10 requests per minute, public endpoint for Chrome extension
    _: Optional[Any] = Depends(RateLimiter(times=10, seconds=60)),
    # API key optional for backward compatibility with Chrome extension
    api_key: Optional[str] = None,
):
    # Check API key if provided
    if api_key and api_key != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API Key"
        )
        
    start_time = datetime.now()
    output_dir = f"analysis_{request.video_id}"
    
    try:
        # Check cache first
        cache_key = get_cache_key(request.video_id, request.days_back, request.max_comments)
        cached_result = get_cached_analysis(cache_key)
        
        if cached_result and (datetime.now() - cached_result['timestamp']) < timedelta(hours=24):
            logger.info(f"Returning cached results for video {request.video_id}")
            return VideoAnalysisResponse(
                video_id=request.video_id,
                analysis_results=AnalysisResults(**cached_result['data']),
                summary=cached_result['data']['summary_paragraph'],
                visualizations=cached_result['data'].get('visualizations', []),
                cached=True,
                timestamp=cached_result['timestamp'],
                processing_time=(datetime.now() - start_time).total_seconds()
            )

        logger.info(f"Starting analysis for video {request.video_id}")
        logger.info(f"Parameters: days_back={request.days_back}, max_comments={request.max_comments}")
        
        # Create and mount analysis directory
        os.makedirs(output_dir, exist_ok=True)
        
        # Track the analysis directory
        if not hasattr(app, "_mounted_directories"):
            app._mounted_directories = set()
        app._mounted_directories.add(output_dir)
        logger.info(f"Analysis directory created and tracked: {output_dir}")
        
        # Default visualization filenames
        visualization_files = [
            "sentiment_distribution.png",
            "engagement_over_time.png",
            "activity_heatmap.png",
            "wordcloud.png"
        ]
        
        # Check if the visualization files exist
        existing_files = []
        for filename in visualization_files:
            file_path = os.path.join(output_dir, filename)
            if os.path.exists(file_path):
                existing_files.append(filename)
                logger.info(f"Visualization file exists: {file_path}")
            else:
                logger.warning(f"Visualization file not found: {file_path}")
        
        # Build visualization URLs
        visualizations = []
        for filename in existing_files:
            # Use relative path from root with proper encoding
            relative_path = f"/analysis/{output_dir}/{filename}"
            visualizations.append(relative_path)
            logger.info(f"Added visualization URL: {relative_path}")
        
        # Initialize service and perform analysis
        try:
            service = CommentAnalysisService()
            # Use optimized parameters for comment fetching with timeout
            results = service.analyze_video_comments(
                video_id=request.video_id,
                days_back=request.days_back,
                max_comments=min(request.max_comments, 250),  # Further limit max comments to 250 for faster response
                max_pages=3,  # Limit to 3 pages of comments for faster response
                output_dir=output_dir,
                timeout_seconds=25  # Set a 25-second timeout for comment fetching
            )
            
            # Check if we got partial results due to timeout
            if results.get('partial_results', False):
                logger.warning(f"Returning partial results for video {request.video_id} due to timeout")

            logger.info("Video comment analysis completed successfully")
            
            # Convert numpy types to Python native types
            results = convert_numpy_types(results)
            
            # Save results to JSON file
            try:
                service.save_analysis_results(results, f"{output_dir}/analysis_results.json")
                logger.info("Analysis results saved to file")
            except Exception as e:
                logger.error(f"Error saving results to file: {str(e)}")
            
            # Add visualizations to results
            results['visualizations'] = visualizations
            
            # Save to cache
            try:
                save_to_cache(cache_key, results)
                logger.info("Results saved to cache")
            except Exception as e:
                logger.error(f"Error saving to cache: {str(e)}")
                
        except Exception as e:
            logger.error(f"Error during analysis: {str(e)}", exc_info=True)
            
            # Create default response for error case
            results = {
                "total_comments": 0,
                "unique_authors": 0,
                "total_likes": 0,
                "average_likes_per_comment": 0.0,
                "engagement_rate": 0.0,
                "sentiment_distribution": {"positive": 0, "neutral": 0, "negative": 0},
                "average_sentiment_score": 0.0,
                "summary_paragraph": f"Error analyzing comments: {str(e)}",
                "visualizations": visualizations
            }
        
        # Add cleanup task
        background_tasks.add_task(cleanup_old_cache)
        
        # Ensure all required fields are present
        required_fields = [
            "total_comments", "unique_authors", "total_likes",
            "average_likes_per_comment", "engagement_rate",
            "sentiment_distribution", "average_sentiment_score",
            "summary_paragraph", "visualizations"
        ]
        
        # Check if any required fields are missing
        if not all(field in results for field in required_fields):
            logger.warning("Missing required fields in results. Creating default structure.")
            error_message = results.get('error', 'Missing required fields')
            results = {
                "total_comments": 0,
                "unique_authors": 0,
                "total_likes": 0,
                "average_likes_per_comment": 0.0,
                "engagement_rate": 0.0,
                "sentiment_distribution": {"positive": 0, "neutral": 0, "negative": 0},
                "average_sentiment_score": 0.0,
                "summary_paragraph": f"Error analyzing comments: {error_message}",
                "visualizations": visualizations
            }
        
        # Create response
        try:
            response = VideoAnalysisResponse(
                video_id=request.video_id,
                analysis_results=AnalysisResults(**results),
                summary=results['summary_paragraph'],
                visualizations=results['visualizations'],
                cached=False,
                timestamp=datetime.now(),
                processing_time=(datetime.now() - start_time).total_seconds()
            )
            logger.info(f"Analysis completed for video {request.video_id}")
            return response
            
        except Exception as e:
            # If we still have validation errors, create a completely valid response
            logger.error(f"Validation error: {str(e)}")
            default_results = {
                "total_comments": 0,
                "unique_authors": 0,
                "total_likes": 0,
                "average_likes_per_comment": 0.0,
                "engagement_rate": 0.0,
                "sentiment_distribution": {"positive": 0, "neutral": 0, "negative": 0},
                "average_sentiment_score": 0.0,
                "summary_paragraph": f"Error analyzing comments: {str(e)}",
                "visualizations": visualizations
            }
            
            return VideoAnalysisResponse(
                video_id=request.video_id,
                analysis_results=AnalysisResults(**default_results),
                summary=default_results['summary_paragraph'],
                visualizations=visualizations,
                cached=False,
                timestamp=datetime.now(),
                processing_time=(datetime.now() - start_time).total_seconds()
            )
    
    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        # Create a valid response even for validation errors
        default_results = {
            "total_comments": 0,
            "unique_authors": 0,
            "total_likes": 0,
            "average_likes_per_comment": 0.0,
            "engagement_rate": 0.0,
            "sentiment_distribution": {"positive": 0, "neutral": 0, "negative": 0},
            "average_sentiment_score": 0.0,
            "summary_paragraph": f"Error: {str(e)}",
            "visualizations": []
        }
        
        return VideoAnalysisResponse(
            video_id=request.video_id,
            analysis_results=AnalysisResults(**default_results),
            summary=default_results['summary_paragraph'],
            visualizations=[],
            cached=False,
            timestamp=datetime.now(),
            processing_time=(datetime.now() - start_time).total_seconds()
        )

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now(),
        "cache_size": len(analysis_cache)
    }

@app.delete("/admin/cache")
async def clear_cache(api_key: str = Depends(get_api_key)):
    """Clear the analysis cache. Requires API key authentication."""
    try:
        global analysis_cache
        cache_size = len(analysis_cache)
        analysis_cache = {}
        return {"status": "success", "message": f"Cleared {cache_size} cache entries"}
    except Exception as e:
        logger.error(f"Error clearing cache: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error clearing cache: {str(e)}"
        )

@app.delete("/cleanup/{video_id}")
async def cleanup_analysis_directory(video_id: str):
    """Delete the analysis directory for a specific video ID"""
    try:
        directory = f"analysis_{video_id}"
        
        # Check if directory exists
        if os.path.isdir(directory):
            # Unmount the directory if it was mounted
            if hasattr(app, "_mounted_directories") and directory in app._mounted_directories:
                # We can't actually unmount in FastAPI, but we can remove it from our tracking
                app._mounted_directories.remove(directory)
                logger.info(f"Unmounted directory: {directory}")
            
            # Remove all files in the directory
            for filename in os.listdir(directory):
                file_path = os.path.join(directory, filename)
                try:
                    if os.path.isfile(file_path):
                        os.unlink(file_path)
                        logger.info(f"Deleted file: {file_path}")
                except Exception as e:
                    logger.error(f"Error deleting file {file_path}: {str(e)}")
            
            # Remove the directory
            os.rmdir(directory)
            logger.info(f"Deleted directory: {directory}")
            
            return {"status": "success", "message": f"Analysis directory for video {video_id} deleted"}
        else:
            logger.warning(f"Directory {directory} does not exist")
            return {"status": "warning", "message": f"Analysis directory for video {video_id} does not exist"}
    except Exception as e:
        logger.error(f"Error cleaning up analysis directory: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error cleaning up analysis directory: {str(e)}"
        )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler"""
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred"}
    )

if __name__ == "__main__":
    # Get configuration from environment variables
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    log_level = os.getenv("LOG_LEVEL", "info").lower()
    
    # Print API key for initial setup
    if os.getenv("API_KEY") is None:
        logger.info(f"No API_KEY found in environment. Generated API key: {API_KEY}")
        logger.info("Add this to your .env file for future use.")
    
    # Start the server
    logger.info(f"Starting CommentPulse API server on {host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level=log_level)
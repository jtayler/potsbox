#!/bin/bash

# Set the path to the queue file and the folder where the sound files are located
QUEUE_FILE="/var/lib/asterisk/sounds/en/queue.txt"
SOUNDS_DIR="/var/lib/asterisk/sounds/en"

# Check if the queue file exists and is not empty
if [[ ! -s $QUEUE_FILE ]]; then
  echo "No files to process."
  exit 1
fi

# Get the list of current files in the queue
queue_files=$(cat $QUEUE_FILE)

# Get the next file in the queue (last line) and remove any leading/trailing whitespace
NEXT_FILE=$(tail -n 1 $QUEUE_FILE | tr -d '[:space:]')

# If a file is found
if [[ -n "$NEXT_FILE" ]]; then
  # Remove the last line from the queue file
  sed -i '$d' $QUEUE_FILE
  
  # Log the file being processed
  echo "Processing file: $NEXT_FILE"
  
  # Return the file name for Asterisk's playback
  echo "$NEXT_FILE"
else
  echo "No more files in the queue."
  exit 1
fi

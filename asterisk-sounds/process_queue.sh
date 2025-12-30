#!/bin/bash

# Set the path to the queue file and the folder where the sound files are located
QUEUE_FILE="/var/lib/asterisk/sounds/en/queue.txt"
SOUNDS_DIR="/var/lib/asterisk/sounds/en"

# Check if the queue file exists and is not empty
if [[ ! -s $QUEUE_FILE ]]; then
  # Return an empty string if there are no files in the queue
  echo "done"
  exit 0
fi

# Get the next file in the queue (last line) and remove any leading/trailing whitespace
NEXT_FILE=$(tail -n 1 $QUEUE_FILE | tr -d '[:space:]')

# If a file is found
if [[ -n "$NEXT_FILE" ]]; then
  # Remove the last line from the queue file
  sed -i '$d' $QUEUE_FILE
  
  # Return the file name for Asterisk's playback
  echo "$NEXT_FILE"
else
  # If no file was found, return an empty string
  echo "done"
fi

#!/bin/bash

# Set the path to the queue file and the folder where the sound files are located
QUEUE_FILE="/var/lib/asterisk/sounds/en/queue.txt"
SOUNDS_DIR="/var/lib/asterisk/sounds/en"

if [[ ! -s $QUEUE_FILE ]]; then
  exit 0
fi

# Get the name of the next file (first line)
NEXT_FILE=$(head -n 1 $QUEUE_FILE | tr -d '[:space:]')

# If a file is found
if [[ -n "$NEXT_FILE" ]]; then
  # Remove the FIRST line from the queue file
  sed -i '1d' $QUEUE_FILE
  
  # Delete the .wav and .ulaw files corresponding to the next file
  rm -f "${SOUNDS_DIR}/${NEXT_FILE}.wav"
  rm -f "${SOUNDS_DIR}/${NEXT_FILE}.ulaw"
fi

#!/bin/bash
# EduChain Security Audit Script
# Runs static analysis using Slither and Mythril via Docker.

echo "=========================================="
echo " Starting EduChain Security Audit"
echo "=========================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker to run security audits."
    exit 1
fi

echo "[1/2] Running Slither (Static Analysis)..."
# Runs slither against the current directory mapped to /share in the container
docker run --rm -v $(pwd):/share trailofbits/eth-security-toolbox slither /share/contracts/Educhain.sol --solc-remaps "@openzeppelin=/share/node_modules/@openzeppelin"

echo ""
echo "[2/2] Running Mythril (Security Analysis)..."
# Runs mythril against the Educhain contract
docker run --rm -v $(pwd):/share mythril/myth analyze /share/contracts/Educhain.sol --solc-json /share/mythril.config.json

echo "=========================================="
echo " Security Audit Completed"
echo "=========================================="

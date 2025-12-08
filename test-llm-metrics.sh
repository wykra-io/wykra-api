#!/bin/bash
# Script to test LLM metrics by making API calls

echo "Testing LLM metrics..."
echo ""

# Test Perplexity endpoint (this will generate LLM metrics)
echo "1. Testing Perplexity search endpoint..."
curl -X POST "http://localhost:3011/api/v1/perplexity/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "test query for metrics"}' \
  -s -o /dev/null -w "Status: %{http_code}\n"

echo ""
echo "2. Checking metrics endpoint for LLM metrics..."
curl -s http://localhost:3011/metrics | grep -E "^llm_" | head -10

echo ""
echo "3. Waiting 5 seconds for Prometheus to scrape..."
sleep 5

echo ""
echo "Done! Check Grafana dashboard now."
echo "If metrics still don't show:"
echo "  - Verify Prometheus is scraping: http://localhost:9090/targets"
echo "  - Check Prometheus query: http://localhost:9090/graph?g0.expr=llm_calls_total"

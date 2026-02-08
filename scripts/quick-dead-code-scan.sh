#!/bin/bash

# Quick Dead Code Detection Script
# Uses grep/find for fast analysis while full TypeScript analyzer runs

PROJECT_ROOT="/Users/gustav/openclaw"
cd "$PROJECT_ROOT"

echo "🔍 Quick Dead Code Scan Starting..."
echo "📁 Scanning TypeScript files in src/"

# Create temporary files for analysis
EXPORTS_FILE=$(mktemp)
IMPORTS_FILE=$(mktemp)
SUSPECTS_FILE=$(mktemp)

echo "📤 Finding exported functions and classes..."
# Find all exports (functions, classes, interfaces, types)
grep -rn "^export \(function\|class\|interface\|type\|const\|let\|var\)" src/ \
    --include="*.ts" \
    --exclude-dir=test \
    --exclude="*.test.ts" > "$EXPORTS_FILE"

echo "📥 Finding imports and usage patterns..."
# Find import statements
grep -rn "^import.*from" src/ \
    --include="*.ts" \
    --exclude-dir=test \
    --exclude="*.test.ts" > "$IMPORTS_FILE"

echo "🕵️ Analyzing for potential dead code..."

# Process exports to find potentially unused ones
while IFS= read -r export_line; do
    if [[ -z "$export_line" ]]; then
        continue
    fi
    
    # Extract export name and file
    export_name=$(echo "$export_line" | sed -n 's/.*export.*\(function\|class\|interface\|type\|const\) \([A-Za-z_][A-Za-z0-9_]*\).*/\2/p')
    export_file=$(echo "$export_line" | cut -d: -f1)
    
    if [[ -n "$export_name" && -n "$export_file" ]]; then
        # Count imports of this export
        import_count=$(grep -r "import.*$export_name" src/ --include="*.ts" --exclude="*.test.ts" | wc -l || echo "0")
        import_count=$(echo $import_count | xargs) # trim whitespace
        
        # Count direct usage (function calls)
        usage_count=$(grep -r "\b$export_name\b" src/ --include="*.ts" --exclude="*.test.ts" --exclude="$export_file" | wc -l || echo "0")
        usage_count=$(echo $usage_count | xargs) # trim whitespace
        
        # Check if used by tests
        test_usage=$(grep -r "\b$export_name\b" src/ --include="*.test.ts" | wc -l || echo "0")
        test_usage=$(echo $test_usage | xargs) # trim whitespace
        
        # Get file size (lines)
        line_num=$(echo "$export_line" | cut -d: -f2)
        file_lines=$(wc -l < "$export_file" 2>/dev/null || echo "0")
        
        # Classify potential dead code
        confidence="LOW"
        reason=""
        
        if [[ "$import_count" -eq 0 && "$usage_count" -eq 0 && "$test_usage" -eq 0 ]]; then
            confidence="HIGH"
            reason="No imports, no usage, not used by tests"
        elif [[ "$import_count" -eq 1 && "$usage_count" -le 1 ]]; then
            confidence="MEDIUM"
            reason="Minimal imports and usage"
        elif [[ "$test_usage" -gt 0 && "$import_count" -eq 0 && "$usage_count" -eq 0 ]]; then
            confidence="MEDIUM"
            reason="Only used by test files"
        elif [[ "$import_count" -le 1 && "$usage_count" -le 2 ]]; then
            confidence="LOW"
            reason="Low imports and usage"
        fi
        
        # Only report if it looks suspicious
        if [[ "$confidence" != "LOW" ]] || [[ "$import_count" -eq 0 && "$usage_count" -eq 0 ]]; then
            echo "$confidence|$export_name|$export_file|$line_num|$import_count|$usage_count|$test_usage|$reason" >> "$SUSPECTS_FILE"
        fi
    fi
done < "$EXPORTS_FILE"

echo "📊 Generating report..."

# Count results
total_exports=$(wc -l < "$EXPORTS_FILE")
total_suspects=$(wc -l < "$SUSPECTS_FILE" 2>/dev/null || echo "0")
high_confidence=$(grep "^HIGH" "$SUSPECTS_FILE" 2>/dev/null | wc -l || echo "0")
medium_confidence=$(grep "^MEDIUM" "$SUSPECTS_FILE" 2>/dev/null | wc -l || echo "0")

echo ""
echo "=== QUICK DEAD CODE ANALYSIS SUMMARY ==="
echo "Total Exports Found: $total_exports"
echo "Potential Dead Code: $total_suspects"
echo "  High Confidence: $high_confidence"
echo "  Medium Confidence: $medium_confidence"
echo ""

# Show top candidates
if [[ "$total_suspects" -gt 0 ]]; then
    echo "=== TOP DEAD CODE CANDIDATES ==="
    echo ""
    
    # Sort by confidence (HIGH first, then MEDIUM)
    (grep "^HIGH" "$SUSPECTS_FILE" 2>/dev/null || true; grep "^MEDIUM" "$SUSPECTS_FILE" 2>/dev/null || true) | head -20 | while IFS='|' read -r confidence name file line imports usage tests reason; do
        relative_file=$(echo "$file" | sed "s|$PROJECT_ROOT/||")
        echo "[$confidence] $name"
        echo "  File: $relative_file:$line"
        echo "  Imports: $imports | Usage: $usage | Test usage: $tests"
        echo "  Reason: $reason"
        echo ""
    done
    
    echo "=== ANALYSIS BY FILE ==="
    echo ""
    
    # Group by file to find files with multiple dead exports
    awk -F'|' '{print $3}' "$SUSPECTS_FILE" | sort | uniq -c | sort -nr | head -10 | while read count file; do
        if [[ "$count" -gt 1 ]]; then
            relative_file=$(echo "$file" | sed "s|$PROJECT_ROOT/||")
            echo "$relative_file: $count potential dead exports"
        fi
    done
fi

# Cleanup
rm -f "$EXPORTS_FILE" "$IMPORTS_FILE" "$SUSPECTS_FILE"

echo ""
echo "✅ Quick analysis complete!"
echo "💡 Run the full TypeScript analyzer for more detailed results."
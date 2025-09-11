// Test file for sanitization function
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";

// Create a DOM window for DOMPurify
const window = new JSDOM("").window;
const createDOMPurify = DOMPurify(window);

// Helper function to sanitize HTML content
const sanitizeHTML = (content) => {
  if (!content || typeof content !== "string") return content;

  // First, convert common markdown patterns to HTML if they exist
  const markdownToHtml = (text) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") // Bold
      .replace(/\*(.*?)\*/g, "<em>$1</em>") // Italic
      .replace(/### (.*?)(\n|$)/g, "<h3>$1</h3>") // H3
      .replace(/## (.*?)(\n|$)/g, "<h2>$1</h2>") // H2
      .replace(/# (.*?)(\n|$)/g, "<h1>$1</h1>") // H1
      .replace(/^\- (.*?)$/gm, "<li>$1</li>") // Bullet points
      .replace(/^\d+\. (.*?)$/gm, "<li>$1</li>") // Numbered list
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      ) // Links
      .replace(/^> (.*?)$/gm, "<blockquote>$1</blockquote>") // Quotes
      .replace(/`(.*?)`/g, "<code>$1</code>") // Inline code
      .replace(/\n/g, "<br>"); // Line breaks
  };

  // Check if content contains markdown patterns
  const hasMarkdown =
    /(\*\*.*?\*\*|\*.*?\*|#{1,6}\s|`.*?`|\[.*?\]\(.*?\)|^[\-\d+\.]\s|^>\s)/m.test(
      content
    );

  // Convert markdown to HTML if needed
  let processedContent = hasMarkdown ? markdownToHtml(content) : content;

  // Wrap consecutive list items in ul tags
  processedContent = processedContent.replace(
    /(<li>.*?<\/li>)(\s*<li>.*?<\/li>)*/g,
    "<ul>$&</ul>"
  );

  // Allow basic HTML tags for rich text content
  const allowedTags = [
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "code",
    "pre",
    "a",
    "hr",
  ];

  const allowedAttributes = {
    a: ["href", "title", "target", "rel"],
    "*": ["class"],
  };

  return createDOMPurify.sanitize(processedContent, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: Object.values(allowedAttributes).flat(),
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
};

// Test cases
const testCases = [
  "**Bold text** and *italic text*",
  "### This is a heading\nWith some content",
  "- Item 1\n- Item 2\n- Item 3",
  "1. First item\n2. Second item\n3. Third item",
  "[Link text](https://example.com)",
  "> This is a quote",
  "`inline code` in text",
  "Plain text without markdown",
  "Mixed **bold** and *italic* with ### heading\n- List item\n`code`",
];

console.log("Testing sanitization function:\n");

testCases.forEach((test, index) => {
  console.log(`Test ${index + 1}:`);
  console.log(`Input: ${test}`);
  console.log(`Output: ${sanitizeHTML(test)}`);
  console.log("---");
});

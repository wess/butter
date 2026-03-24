#include "butter.h"
#include <string.h>
#include <ctype.h>
#include <stdlib.h>

BUTTER_EXPORT(
  int char_count(const char *input, char target) {
    int count = 0;
    for (int i = 0; input[i]; i++) {
      if (input[i] == target) count++;
    }
    return count;
  }

  int word_count(const char *input) {
    int count = 0;
    int in_word = 0;
    for (int i = 0; input[i]; i++) {
      if (isspace(input[i])) {
        in_word = 0;
      } else if (!in_word) {
        in_word = 1;
        count++;
      }
    }
    return count;
  }

  int is_palindrome(const char *input, int len) {
    for (int i = 0; i < len / 2; i++) {
      if (tolower(input[i]) != tolower(input[len - 1 - i])) return 0;
    }
    return 1;
  }
)

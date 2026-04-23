#!/usr/bin/env bats

@test "K/N ACTUAL_WITHOUT_EXPECT @Suppress is exempt from block" {
  # Simulate diff line with K/N suppress
  line='+    @Suppress("ACTUAL_WITHOUT_EXPECT")'
  result=$(echo "$line" | grep -E '@Suppress\(' | grep -vcE 'ACTUAL_WITHOUT_EXPECT|EXPECT_ACTUAL_CLASSIFIERS_ARE_IN_BETA_WARNING|NO_ACTUAL_FOR_EXPECT|INVISIBLE_MEMBER|INVISIBLE_REFERENCE' || true)
  [ "$result" -eq 0 ]
}

@test "K/N INVISIBLE_MEMBER @Suppress is exempt from block" {
  line='+    @Suppress("INVISIBLE_MEMBER")'
  result=$(echo "$line" | grep -E '@Suppress\(' | grep -vcE 'ACTUAL_WITHOUT_EXPECT|EXPECT_ACTUAL_CLASSIFIERS_ARE_IN_BETA_WARNING|NO_ACTUAL_FOR_EXPECT|INVISIBLE_MEMBER|INVISIBLE_REFERENCE' || true)
  [ "$result" -eq 0 ]
}

@test "Generic @Suppress UnusedImport is still blocked" {
  line='+    @Suppress("UnusedImport")'
  result=$(echo "$line" | grep -E '@Suppress\(' | grep -vcE 'ACTUAL_WITHOUT_EXPECT|EXPECT_ACTUAL_CLASSIFIERS_ARE_IN_BETA_WARNING|NO_ACTUAL_FOR_EXPECT|INVISIBLE_MEMBER|INVISIBLE_REFERENCE' || true)
  [ "$result" -gt 0 ]
}

@test "Generic @SuppressWarnings is still blocked" {
  line='+    @SuppressWarnings("all")'
  result=$(echo "$line" | grep -E '@Suppress\(|@SuppressWarnings\(' | grep -vcE 'ACTUAL_WITHOUT_EXPECT|EXPECT_ACTUAL_CLASSIFIERS_ARE_IN_BETA_WARNING|NO_ACTUAL_FOR_EXPECT|INVISIBLE_MEMBER|INVISIBLE_REFERENCE' || true)
  [ "$result" -gt 0 ]
}

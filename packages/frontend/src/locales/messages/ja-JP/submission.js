return {
  title: "提出",
  cancel: "中止",
  confirm_cancel: "中止する",
  success_cancel: "ジャッジの中止に成功しました。",
  rejudge: "リジャッジ",
  confirm_rejudge: "リジャッジする",
  success_rejudge: "リジャッジに成功しました。",
  set_public: "[TBT] Make Public",
  confirm_set_public: "[TBT] Confirm make public",
  success_set_public: "[TBT] Successfully made public.",
  set_non_public: "[TBT] Make Non-public",
  confirm_set_non_public: "[TBT] Confirm made non-public",
  success_set_non_public: "[TBT] Successfully make non-public.",
  delete: "[TBT] Delete",
  confirm_delete: "[TBT] Confirm delete",
  success_delete: "[TBT] Successfully deleted.",
  error: {
    NO_SUCH_PROBLEM: "問題が存在しません。",
    NO_SUCH_FILE: "ファイルが存在しません。",
    NO_SUCH_SUBMISSION: "提出が存在しません。",
    PERMISSION_DENIED: "権限がありません。"
  },
  hack: {
    button: "Hack",
    title: "この提出を Hack する",
    explanation:
      "この満点の提出が失敗すると思う入力データをアップロードしてください。このデータで満点を取れなければ Hack 成功です。",
    file_label: "Hack の入力データ",
    cancel: "中止",
    confirm: "Hack を送信",
    success_create: "Hack を送信しました。",
    upload_cancelled: "アップロードを中止しました。",
    upload_error: "ファイルのアップロードに失敗しました：{error}",
    list_title: "Hack 一覧",
    columns: {
      id: "ID",
      hacker: "Hack したユーザー",
      submit_time: "提出日時",
      status: "状態"
    },
    status: {
      judging: "ジャッジ中",
      hacked: "Hack 成功",
      failed: "Hack 失敗"
    },
    error: {
      NO_SUCH_PROBLEM: "問題が存在しません。",
      PROBLEM_NOT_HACKABLE: "[TBT] This problem is not hackable.",
      NO_SUCH_SUBMISSION: "提出が存在しません。",
      SUBMISSION_NOT_ACCEPTED: "[TBT] This submission is not accepted.",
      PERMISSION_DENIED: "権限がありません。",
      FILE_TOO_LARGE: "[TBT] The file is too large.",
      FILE_UUID_EXISTS: "[TBT] The file already exists.",
      FILE_NOT_UPLOADED: "[TBT] The file was not uploaded."
    }
  },
  failed_to_format: "コードのフォーマットに失敗しました：{error}",
  format_code: "コードをフォーマットする",
  show_original_code: "オリジナルを表示",
  compilation_message: "コンパイルメッセージ",
  system_message: "システムメッセージ",
  sample: "サンプル",
  sample_testcase: "サンプル",
  extra_test: "[TBT] Extra Tests",
  subtask: {
    title: "サブタスク",
    score: "得点："
  },
  testcase: {
    title: "テストケース",
    score: "得点：",
    input: "入力",
    output: "想定解",
    user_output: "出力",
    user_error: "エラー出力",
    checker_message: "ジャッジのメッセージ",
    interactor_message: "[TBT] Interactor message",
    system_message: "システムメッセージ"
  }
};

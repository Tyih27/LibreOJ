return {
  title: "提交记录",
  cancel: "取消",
  confirm_cancel: "确认取消",
  success_cancel: "成功取消评测。",
  rejudge: "重测",
  confirm_rejudge: "确认重测",
  success_rejudge: "成功重新评测。",
  set_public: "设为公开",
  confirm_set_public: "确认公开",
  success_set_public: "成功公开。",
  set_non_public: "取消公开",
  confirm_set_non_public: "确认取消公开",
  success_set_non_public: "成功取消公开。",
  delete: "删除",
  confirm_delete: "确认删除",
  success_delete: "删除成功。",
  error: {
    NO_SUCH_PROBLEM: "无此题目。",
    NO_SUCH_FILE: "无此文件。",
    NO_SUCH_SUBMISSION: "无此提交记录。",
    PERMISSION_DENIED: "权限不足。"
  },
  hack: {
    button: "Hack",
    title: "Hack 此提交记录",
    explanation: "上传一份你认为该满分提交会出错的测试数据。若该提交在这份数据上不能获得满分，则 Hack 成功。",
    file_label: "Hack 输入数据",
    cancel: "取消",
    confirm: "提交 Hack",
    success_create: "Hack 已提交。",
    upload_cancelled: "上传已取消。",
    upload_error: "上传文件失败：{error}",
    list_title: "Hack 记录",
    columns: {
      id: "ID",
      hacker: "发起者",
      submit_time: "提交时间",
      status: "状态"
    },
    status: {
      judging: "评测中",
      hacked: "Hack 成功",
      failed: "Hack 失败"
    },
    error: {
      NO_SUCH_PROBLEM: "无此题目。",
      PROBLEM_NOT_HACKABLE: "此题目不可被 Hack。",
      NO_SUCH_SUBMISSION: "无此提交记录。",
      SUBMISSION_NOT_ACCEPTED: "该提交记录未被接受。",
      PERMISSION_DENIED: "权限不足。",
      FILE_TOO_LARGE: "文件过大。",
      FILE_UUID_EXISTS: "文件已存在。",
      FILE_NOT_UPLOADED: "文件未上传。"
    }
  },
  failed_to_format: "格式化代码出错：{error}",
  format_code: "格式化代码",
  show_original_code: "显示原始代码",
  compilation_message: "编译信息",
  system_message: "系统信息",
  sample: "样例",
  sample_testcase: "样例",
  extra_test: "额外测试",
  subtask: {
    title: "子任务",
    score: "得分："
  },
  testcase: {
    title: "测试点",
    score: "得分：",
    input: "输入文件",
    output: "答案文件",
    user_output: "你的输出",
    user_error: "你的标准错误输出",
    checker_message: "检查器信息",
    interactor_message: "交互器信息",
    system_message: "系统信息"
  }
};
